<#
.SYNOPSIS
  剑星 Mod 管理器（SBModManager）一键安装脚本。

.DESCRIPTION
  从 GitHub Release（reloadbug/SBModManager）取最新（或指定）版本的安装包，
  校验大小后静默安装。只装到当前用户目录，不需要管理员权限。

  默认装「安装版」（setup.exe）；加 -Portable 则改为下载免安装的便携版。

  中国大陆直连 github.com 常常很慢甚至不通，可以：
    · 用 -Mirror 走加速前缀，例如：-Mirror https://ghfast.top/
    · 或者自己下好 exe，用 -LocalFile 指定本地文件，完全不联网

.PARAMETER Version
  指定版本号，例如 0.2.10 或 v0.2.10。默认取最新 Release。

.PARAMETER Portable
  下载便携版（-portable.exe）而不是安装版。便携版不写注册表、不建快捷方式。

.PARAMETER InstallDir
  安装目录。安装版会透传给安装程序（NSIS /D=）；便携版则作为落地目录。

.PARAMETER LocalFile
  使用本地已有的 exe，不联网下载。

.PARAMETER Mirror
  下载加速前缀，会拼成 <镜像>/<原始下载地址>。

.PARAMETER NoLaunch
  装完不自动启动程序。

.PARAMETER DryRun
  只显示将要做什么，不下载、不安装。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Version 0.2.10 -InstallDir "D:\Tools\SBModManager"

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -LocalFile "D:\下载\SBModManager-0.2.10-setup.exe"
#>

[CmdletBinding()]
param(
  [string] $Version    = '',
  [switch] $Portable,
  [string] $InstallDir = '',
  [string] $LocalFile  = '',
  [string] $Mirror     = '',
  [switch] $NoLaunch,
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$Repo    = 'reloadbug/SBModManager'
$ApiBase = 'https://api.github.com/repos/' + $Repo
$GhBase  = 'https://github.com/' + $Repo
$AppExe  = '剑星 Mod 管理器.exe'
$DataDir = Join-Path $env:APPDATA '剑星 Mod 管理器'

# ------------------------------------------------------------------ 输出助手
function Say  { param([string]$m) Write-Host ('  ' + $m) }
function Note { param([string]$m) Write-Host ('  ' + $m) -ForegroundColor DarkGray }
function Ok   { param([string]$m) Write-Host ('  [OK] ' + $m) -ForegroundColor Green }
function Warn { param([string]$m) Write-Host ('  [!]  ' + $m) -ForegroundColor Yellow }
function Head { param([string]$m) Write-Host ''; Write-Host ('  ' + $m) -ForegroundColor Cyan }

function SizeText { param([long]$b) return ('{0:N1} MB' -f ($b / 1MB)) }

function Die {
  param([string]$m)
  Write-Host ''
  Write-Host ('  安装失败：' + $m) -ForegroundColor Red
  Write-Host ('  手动下载：' + $GhBase + '/releases/latest')
  Write-Host '  下好之后用  -LocalFile <文件路径>  再跑一次本脚本。'
  Write-Host ''
  exit 1
}

# ------------------------------------------------------------------ 下载（带进度条）
function Get-File {
  param([string]$Url, [string]$Dest, [long]$ExpectedSize)

  $part = $Dest + '.part'
  if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue }

  $req = [Net.HttpWebRequest]::Create($Url)
  $req.UserAgent         = 'SBModManager-Installer'
  $req.Timeout           = 60000
  $req.ReadWriteTimeout  = 180000
  $req.AllowAutoRedirect = $true

  try {
    $resp = $req.GetResponse()
  } catch {
    Die ('下载失败：' + $_.Exception.Message)
  }

  $total = [long]$resp.ContentLength
  if ($total -le 0) { $total = $ExpectedSize }

  $in  = $resp.GetResponseStream()
  $out = [IO.File]::Create($part)
  $buf = New-Object byte[] 1048576
  $got = [long]0
  $last = -1
  try {
    while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
      $out.Write($buf, 0, $n)
      $got += $n
      if ($total -gt 0) {
        $pct = [int](100 * $got / $total)
        if ($pct -ne $last) {
          $last = $pct
          $bar  = ('#' * [int]($pct / 4)).PadRight(25)
          Write-Host -NoNewline ("`r  [" + $bar + '] ' + $pct.ToString().PadLeft(3) + '%  ' + (SizeText $got) + ' / ' + (SizeText $total))
        }
      }
    }
  } finally {
    $out.Close(); $in.Close(); $resp.Close()
  }
  Write-Host ''

  $real = [long](Get-Item -LiteralPath $part).Length
  if ($ExpectedSize -gt 0 -and $real -ne $ExpectedSize) {
    Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
    Die ('下载不完整：期望 ' + $ExpectedSize + ' 字节，实际 ' + $real + ' 字节，请重试。')
  }
  if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue }
  Move-Item -LiteralPath $part -Destination $Dest -Force
  Ok ('已下载：' + $Dest + '  (' + (SizeText $real) + ')')
}

# ------------------------------------------------------------------ 从注册表反查安装位置
function Find-InstallDir {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($r in $roots) {
    if (-not (Test-Path $r)) { continue }
    foreach ($s in (Get-ChildItem -Path $r -ErrorAction SilentlyContinue)) {
      $p = Get-ItemProperty -Path $s.PSPath -ErrorAction SilentlyContinue
      if (-not $p) { continue }
      $dn = [string]$p.DisplayName
      if ($dn -like '*剑星*' -or $dn -like '*SBModManager*') {
        $il = [string]$p.InstallLocation
        if ($il -and (Test-Path -LiteralPath $il)) { return $il }
        $us = [string]$p.UninstallString
        if ($us -match '"([^"]+)"') {
          $d = Split-Path -Parent $Matches[1]
          if (Test-Path -LiteralPath $d) { return $d }
        }
      }
    }
  }
  return ''
}

# ================================================================== 主流程
Write-Host ''
Write-Host '  ===============================================' -ForegroundColor DarkCyan
Write-Host '    剑星 Mod 管理器 (SBModManager)  一键安装' -ForegroundColor Cyan
Write-Host '  ===============================================' -ForegroundColor DarkCyan

if (-not [Environment]::Is64BitOperatingSystem) {
  Die '本程序只有 64 位版本，当前系统是 32 位 Windows。'
}

if ($Portable) { $kind = 'portable'; $kindName = '便携版（免安装）' }
else           { $kind = 'setup';    $kindName = '安装版' }

$url     = ''
$size    = [long]0
$name    = ''
$exePath = ''
$tag     = ''

if ($LocalFile) {
  # ---------------------------------------------------------------- 用本地文件
  if (-not (Test-Path -LiteralPath $LocalFile)) { Die ('找不到本地文件：' + $LocalFile) }
  $exePath = (Resolve-Path -LiteralPath $LocalFile).Path
  $size    = [long](Get-Item -LiteralPath $exePath).Length
  $name    = [IO.Path]::GetFileName($exePath)
  Ok ('使用本地文件：' + $exePath + '  (' + (SizeText $size) + ')')
}
else {
  # ---------------------------------------------------------------- 查 Release
  $api = $ApiBase + '/releases/latest'
  if ($Version) {
    $v = $Version
    if ($v -notmatch '^v') { $v = 'v' + $v }
    $api = $ApiBase + '/releases/tags/' + $v
  }

  Head ('查询 Release：' + $api)
  $rel = $null
  try {
    $rel = Invoke-RestMethod -Uri $api -TimeoutSec 30 -Headers @{
      'User-Agent' = 'SBModManager-Installer'
      'Accept'     = 'application/vnd.github+json'
    }
  } catch {
    Warn ('GitHub API 取不到（' + $_.Exception.Message + '），改试静态直链。')
  }

  if ($rel) {
    $tag     = [string]$rel.tag_name
    $pattern = '^SBModManager-.*-' + $kind + '\.exe$'
    $asset   = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
    if (-not $asset) { Die ('Release ' + $tag + ' 里没有 ' + $kindName + ' 的安装包。') }
    $url  = [string]$asset.browser_download_url
    $size = [long]$asset.size
    $name = [string]$asset.name
    Ok ('版本：' + $tag + '    ' + $name + '  (' + (SizeText $size) + ')')
  }
  else {
    if (-not $Version) {
      try {
        $resp  = Invoke-WebRequest -Uri ($GhBase + '/releases/latest') -UseBasicParsing -TimeoutSec 30
        $final = [string]$resp.BaseResponse.ResponseUri
        if ($final -match '/releases/tag/([^/?#]+)') { $tag = $Matches[1] }
      } catch { }
    } else {
      $tag = $Version
      if ($tag -notmatch '^v') { $tag = 'v' + $tag }
    }
    if (-not $tag) { Die 'GitHub API 与静态直链都取不到版本号，请检查网络，或改用 -LocalFile。' }
    $name = 'SBModManager-' + ($tag -replace '^v', '') + '-' + $kind + '.exe'
    $url  = $GhBase + '/releases/download/' + $tag + '/' + $name
    Warn ('改用静态直链：' + $url)
  }

  if ($Mirror) {
    $url = $Mirror.TrimEnd('/') + '/' + $url
    Note ('已套用镜像前缀：' + $url)
  }
}

$dest = Join-Path $env:TEMP $name

# ------------------------------------------------------------------ 预演
if ($DryRun) {
  Head '预演（没有做任何改动）'
  if ($url) { Say ('下载地址：' + $url) } else { Say ('使用本地文件：' + $exePath) }
  if ($url) { Say ('保存到：'  + $dest) }
  Say ('安装方式：' + $kindName)
  if ($InstallDir) { Say ('安装目录：' + $InstallDir) }
  elseif ($Portable) { Say '安装目录：默认（%LOCALAPPDATA%\Programs\SBModManager）' }
  else { Say '安装目录：默认（安装版为 %LOCALAPPDATA%\Programs\剑星 Mod 管理器）' }
  Say '去掉 -DryRun 即真正执行。'
  Write-Host ''
  exit 0
}

# ------------------------------------------------------------------ 下载
$pkg = $exePath
if (-not $pkg) {
  $cached = $false
  if ($size -gt 0 -and (Test-Path -LiteralPath $dest)) {
    if ([long](Get-Item -LiteralPath $dest).Length -eq $size) { $cached = $true }
  }
  if ($cached) {
    Ok ('本机已有同大小的安装包，跳过下载：' + $dest)
  } else {
    Head ('下载 ' + $kindName + '（' + (SizeText $size) + '）')
    Get-File -Url $url -Dest $dest -ExpectedSize $size
  }
  $pkg = $dest
}

# ------------------------------------------------------------------ 安装
$loc = ''

if ($Portable) {
  $dir = $InstallDir
  if (-not $dir) { $dir = Join-Path $env:LOCALAPPDATA 'Programs\SBModManager' }
  if (-not [IO.Path]::IsPathRooted($dir)) { $dir = Join-Path (Get-Location).Path $dir }

  Head ('放置便携版到 ' + $dir)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Copy-Item -LiteralPath $pkg -Destination (Join-Path $dir $AppExe) -Force
  Ok ('已放到：' + (Join-Path $dir $AppExe))
  $loc = $dir
}
else {
  $running = Get-Process -ErrorAction SilentlyContinue |
             Where-Object { $_.ProcessName -like '*剑星*' -or $_.ProcessName -like '*SBModManager*' }
  if ($running) { Warn '检测到程序正在运行，安装程序会自动关掉它。' }

  $flags = '/S'
  if ($InstallDir) {
    $loc = $InstallDir
    if (-not [IO.Path]::IsPathRooted($loc)) { $loc = Join-Path (Get-Location).Path $loc }
    $flags = $flags + ' /D=' + $loc
    Say ('安装目录：' + $loc)
  }

  Head '正在静默安装（大约 10-60 秒，请勿关闭窗口）'
  $proc = Start-Process -FilePath $pkg -ArgumentList $flags -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    Die ('安装程序返回错误码 ' + $proc.ExitCode + '。可改用便携版：本脚本加 -Portable。')
  }
  Ok '安装程序执行完毕'

  if (-not $loc) {
    $loc = Find-InstallDir
    if (-not $loc) { $loc = Join-Path $env:LOCALAPPDATA 'Programs\剑星 Mod 管理器' }
  }
}

# ------------------------------------------------------------------ 收尾
Head '安装完成'
Say ('安装位置：' + $loc)
if ($Portable) { Say ('启动：双击 ' + (Join-Path $loc $AppExe)) }
else           { Say '启动：开始菜单搜索「剑星 Mod 管理器」，或桌面快捷方式' }
Say '卸载：Windows 设置 → 应用 → 剑星 Mod 管理器 → 卸载'
Say ('Mod 与设置数据：' + $DataDir + '  （卸载不会删除）')

if (-not $NoLaunch) {
  $target = Join-Path $loc $AppExe
  if (Test-Path -LiteralPath $target) {
    Start-Process -FilePath $target | Out-Null
    Ok '已启动程序'
  } else {
    Warn ('没找到 ' + $target + '，请手动从开始菜单启动。')
  }
}

Write-Host ''
Ok '全部完成。'
