/* 생활 계산소 - 화면 보조 스크립트 (ui.js) */
(function () {
  'use strict';

  function won(n, suffix) {
    var v = Math.round(Number(n) || 0);
    return v.toLocaleString('ko-KR') + (suffix === false ? '' : '원');
  }

  function num(n) {
    return (Math.round(Number(n) || 0)).toLocaleString('ko-KR');
  }

  function manwon(n) {
    var v = Number(n) || 0;
    if (Math.abs(v) >= 100000000) {
      var eok = Math.floor(v / 100000000);
      var rest = Math.round((v % 100000000) / 10000);
      return eok + '억' + (rest ? ' ' + rest.toLocaleString('ko-KR') + '만' : '') + '원';
    }
    if (Math.abs(v) >= 10000) {
      var man = Math.floor(v / 10000);
      var wonRest = Math.round(v % 10000);
      return man.toLocaleString('ko-KR') + '만' + (wonRest ? ' ' + wonRest.toLocaleString('ko-KR') : '') + '원';
    }
    return won(v);
  }

  function text(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function html(id, value) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = value;
  }

  function value(id) {
    var el = document.getElementById(id);
    if (!el) return 0;
    return window.LifeCalc.toNumber(el.value);
  }

  // 빈칸이면 null, 직접 넣은 값(0 포함)이면 숫자를 돌려준다.
  function optionalValue(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    return window.LifeCalc.optionalNumber(el.value);
  }

  // 숫자 입력란에 천 단위 쉼표를 붙인다.
  function bindMoneyInputs(root) {
    var scope = root || document;
    var list = scope.querySelectorAll('input[data-money]');
    Array.prototype.forEach.call(list, function (el) {
      if (el.dataset.bound === '1') return;
      el.dataset.bound = '1';
      el.addEventListener('input', function () {
        var digits = String(el.value).replace(/[^0-9]/g, '');
        if (digits === '') {
          el.value = '';
          return;
        }
        var raw = window.LifeCalc.toNumber(digits);
        var pos = el.value.length - el.selectionStart;
        // 0을 직접 넣은 경우에도 지우지 않고 그대로 둔다.
        el.value = raw.toLocaleString('ko-KR');
        try {
          var next = Math.max(0, el.value.length - pos);
          el.setSelectionRange(next, next);
        } catch (e) {
          /* selection 미지원 브라우저는 무시 */
        }
      });
    });
  }

  // 폼이 바뀔 때마다 계산한다.
  function onInput(form, handler) {
    if (!form) return;
    form.addEventListener('input', handler);
    form.addEventListener('change', handler);
    handler();
  }

  function renderRows(tbodyId, rows, mapper) {
    var tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = rows
      .map(function (row) {
        var cells = mapper(row);
        return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      })
      .join('');
  }

  function initNav() {
    var path = location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('.site-nav a').forEach(function (a) {
      var target = a.getAttribute('href').replace(/\/$/, '') || '/';
      if (target !== '/' && path.indexOf(target) === 0) a.setAttribute('aria-current', 'page');
      if (target === '/' && path === '/') a.setAttribute('aria-current', 'page');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindMoneyInputs();
    initNav();
  });

  window.UI = {
    won: won,
    num: num,
    manwon: manwon,
    text: text,
    html: html,
    value: value,
    optionalValue: optionalValue,
    bindMoneyInputs: bindMoneyInputs,
    onInput: onInput,
    renderRows: renderRows
  };
})();
