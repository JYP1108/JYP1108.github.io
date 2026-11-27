/*!
 * 생활 계산소 - 연말정산 계산 검증 (Node 전용, 의존성 없음)
 * 실행: node tests/tax-refund.test.js
 *
 * 기준: 소득세법 제59조의3 (연금계좌 세액공제) 제1항 단서
 *  - 연금저축계좌 납입액은 연 600만원까지만 인정
 *  - 연금저축 600만원 이내 금액 + 퇴직연금계좌(IRP) 납입액 합계 900만원 한도
 *  - 총급여 5,500만원 이하 15%, 초과 12%
 * 기준: 원천징수액(기납부세액)은 빈칸일 때만 추정, 0을 넣으면 0원으로 계산
 */
'use strict';

const assert = require('assert');
const path = require('path');
const LifeCalc = require(path.join(__dirname, '..', 'assets', 'calc-core.js'));

const yearEndTax = LifeCalc.yearEndTax;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
    console.log('  ✗ ' + name + ' — ' + err.message);
  }
}

function group(title) {
  console.log('\n' + title);
}

/* ------------------------------------------------------------------ *
 * ① 연금저축 600만원 / 연금계좌 합산 900만원 (제59조의3 제1항 단서)
 * ------------------------------------------------------------------ */
group('① 연금계좌 세액공제 한도 (연금저축 600만 + IRP 합산 900만)');

test('총급여 5,000만원 + 연금저축 900만원 + IRP 0 → 900,000원', () => {
  const r = yearEndTax({ grossSalary: 50000000, pensionSavings: 9000000, irp: 0 });
  assert.strictEqual(r.credits.pensionBase, 6000000, '연금저축은 600만원까지만 인정');
  assert.strictEqual(r.credits.pension, 900000, '600만원 × 15% = 90만원');
});

test('총급여 5,000만원 + 연금저축 600만원 + IRP 300만원 → 1,350,000원', () => {
  const r = yearEndTax({ grossSalary: 50000000, pensionSavings: 6000000, irp: 3000000 });
  assert.strictEqual(r.credits.pensionBase, 9000000);
  assert.strictEqual(r.credits.pension, 1350000, '900만원 × 15% = 135만원');
});

test('연금저축 900만원 + IRP 300만원이면 합산 900만원까지만', () => {
  const r = yearEndTax({ grossSalary: 50000000, pensionSavings: 9000000, irp: 3000000 });
  assert.strictEqual(r.credits.pensionBase, 9000000);
  assert.strictEqual(r.credits.pension, 1350000);
});

test('연금저축 600만원 + IRP 600만원도 합산 한도 900만원', () => {
  const r = yearEndTax({ grossSalary: 50000000, pensionSavings: 6000000, irp: 6000000 });
  assert.strictEqual(r.credits.pensionBase, 9000000);
});

test('IRP만 900만원이면 합산 한도 900만원 전액이 대상', () => {
  const r = yearEndTax({ grossSalary: 50000000, pensionSavings: 0, irp: 9000000 });
  assert.strictEqual(r.credits.pensionBase, 9000000);
  assert.strictEqual(r.credits.pension, 1350000);
});

test('총급여 5,500만원 이하는 15%, 넘으면 12%', () => {
  const low = yearEndTax({ grossSalary: 55000000, pensionSavings: 9000000, irp: 0 });
  const high = yearEndTax({ grossSalary: 55000001, pensionSavings: 9000000, irp: 0 });
  assert.strictEqual(low.credits.pension, 900000, '5,500만원 이하 600만원 × 15%');
  assert.strictEqual(high.credits.pension, 720000, '초과 600만원 × 12%');
  const highSplit = yearEndTax({ grossSalary: 60000000, pensionSavings: 6000000, irp: 3000000 });
  assert.strictEqual(highSplit.credits.pension, 1080000, '초과 구간 900만원 × 12%');
});

test('쉼표 문자가 들어간 입력도 같은 결과', () => {
  const r = yearEndTax({ grossSalary: '50,000,000', pensionSavings: '9,000,000', irp: '0' });
  assert.strictEqual(r.credits.pension, 900000);
});

test('연금계좌 납입이 없으면 0원', () => {
  const r = yearEndTax({ grossSalary: 50000000, pensionSavings: 0, irp: 0 });
  assert.strictEqual(r.credits.pension, 0);
  assert.strictEqual(r.credits.pensionBase, 0);
});

test('legacy 단일 키 pensionAccount는 합산액으로 보고 그대로 인정 (하위 호환)', () => {
  const r = yearEndTax({ grossSalary: 50000000, pensionAccount: 9000000 });
  assert.strictEqual(r.credits.pensionBase, 9000000);
  assert.strictEqual(r.credits.pension, 1350000, '수정 전과 같은 결과 유지');
  const capped = yearEndTax({ grossSalary: 50000000, pensionAccount: 12000000 });
  assert.strictEqual(capped.credits.pension, 1350000, '900만원 초과분은 인정하지 않음');
});

/* ------------------------------------------------------------------ *
 * ② 원천징수액 0 입력 vs 빈칸
 * ------------------------------------------------------------------ */
group('② 원천징수액(기납부세액) 0 입력과 빈칸 구분');

test('총급여 6,000만원 + 기납부세액 0 입력 → 0원 적용 (추정치 미사용)', () => {
  const r = yearEndTax({ grossSalary: 60000000, prepaidTax: 0 });
  assert.strictEqual(r.prepaid, 0);
  assert.strictEqual(r.prepaidIsEstimate, false, '0을 직접 넣었으므로 추정이 아님');
  assert.strictEqual(r.refund, -r.determinedTax);
});

test('문자열 "0"·"0원"도 직접 입력한 0으로 처리', () => {
  ['0', '0원', ' 0 '].forEach((v) => {
    const r = yearEndTax({ grossSalary: 60000000, prepaidTax: v });
    assert.strictEqual(r.prepaid, 0, v + ' → 기납부 0원');
    assert.strictEqual(r.prepaidIsEstimate, false);
  });
});

test('빈칸("")·공백만·null·undefined는 추정치 적용', () => {
  const estimate = yearEndTax({ grossSalary: 60000000 });
  assert.strictEqual(estimate.prepaid, 4515000, '총급여 6,000만원 추정 원천징수액');
  assert.strictEqual(estimate.prepaidIsEstimate, true);

  ['', '   ', null, undefined].forEach((v) => {
    const r = yearEndTax({ grossSalary: 60000000, prepaidTax: v });
    assert.strictEqual(r.prepaid, estimate.prepaid, String(v) + ' → 추정치');
    assert.strictEqual(r.prepaidIsEstimate, true);
  });
});

test('직접 넣은 원천징수액은 그대로 기납부세액으로 사용', () => {
  const r = yearEndTax({ grossSalary: 60000000, prepaidTax: '1,200,000' });
  assert.strictEqual(r.prepaid, 1200000);
  assert.strictEqual(r.prepaidIsEstimate, false);
  assert.strictEqual(r.refund, 1200000 - r.determinedTax);
});

test('기납부 0원이면 환급액은 결정세액만큼 추가 납부로 표시', () => {
  const r = yearEndTax({ grossSalary: 60000000, prepaidTax: 0 });
  assert.strictEqual(r.refund, -r.determinedTax);
  assert.ok(Math.abs(r.refundWithLocal + r.determinedTotal) <= 1, '지방소득세 포함 금액도 음수');
});

/* ------------------------------------------------------------------ *
 * ③ 기존 계산 흐름이 깨지지 않았는지
 * ------------------------------------------------------------------ */
group('③ 통합·회귀');

test('총급여 6,000만원 + 기납부 0 + 연금저축 900만원 → 세액공제 72만원', () => {
  const r = yearEndTax({ grossSalary: 60000000, prepaidTax: 0, pensionSavings: 9000000, irp: 0 });
  assert.strictEqual(r.credits.pensionBase, 6000000, '연금저축 900만원 중 600만원만 인정');
  assert.strictEqual(r.credits.pension, 720000, '600만원 × 12%');
  assert.strictEqual(r.prepaid, 0);
});

test('카드 공제·표준세액공제 비교 결과가 유지된다', () => {
  const r = yearEndTax({ grossSalary: 50000000, credit: 40000000, market: 22500000, children: 2 });
  assert.strictEqual(r.card.deduction, 7000000);
  assert.ok(Number.isFinite(r.refundWithLocal));
  assert.ok(Number.isFinite(r.determinedTax));
});

/* ------------------------------------------------------------------ */
console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') + ' — ' + passed + '개 통과, ' + failed + '개 실패');
if (failed > 0) {
  failures.forEach((f) => console.log('  · ' + f.name + ': ' + f.message));
  process.exit(1);
}
