return {
  page: (document.querySelector('.nav-i.on') || {}).textContent || '?',
  dlBar: !!document.querySelector('.dl-bar'),
  reviewBtns: document.querySelectorAll('[data-dl-refreshplans]').length,
  reviewRows: document.querySelectorAll('.live .li.rev').length,
  rows: document.querySelectorAll('.dl-item').length
};
