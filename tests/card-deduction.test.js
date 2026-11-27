/*!
 * 생활 계산소 - 신용카드 등 소득공제 계산 검증 (Node 전용, 의존성 없음)
 * 실행: node tests/card-deduction.test.js
 *
 * 기준: 조세특례제한법 제126조의2 (2026년 시행) · 시행령 제121조의2 제18항
 *  - 제2항: 최저사용금액은 신용(15%) → 체크·현금(30%) → 문화체육(30%) → 전통시장·대중교통(40%) 순으로 차감
 *  - 제10항: 기본한도 300만원(7,000만원 초과 250만원), 기본공제 자녀·손자녀 1명당 50만원(25만원) 가산
 *  - 제11항: 기본한도를 넘는 금액은 시장·교통(7,000만원 이하면 문화체육 포함) 공제액 범위에서 추가한도까지 인정
 */
'use strict';

const assert = require('assert');
const path = require('path');
const LifeCalc = require(path.join(__dirname, '..', 'assets', 'calc-core.js'));

const cardDeduction = LifeCalc.cardDeduction;

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
 * ① 기본한도·추가한도 합산 구조 (제10항·제11항)
 * ------------------------------------------------------------------ */
group('① 기본한도·추가한도 합산 구조');

test('baseAmount=0, addAmount=400만원 → 소득공제 400만원', () => {
  // 총급여 5,000만원 → 최저사용금액 1,250만원. 전통시장 2,250만원 결제.
  const r = cardDeduction({ grossSalary: 50000000, market: 22500000 });
  assert.strictEqual(r.baseAmount, 0, '기본 공제액은 0원이어야 함');
  assert.strictEqual(r.addAmount, 4000000, '추가 공제액은 400만원이어야 함');
  assert.strictEqual(r.baseLimit, 3000000);
  assert.strictEqual(r.baseApplied, 3000000, '기본한도 300만원은 이 금액 전체에 먼저 씌운다');
  assert.strictEqual(r.excess, 1000000);
  assert.strictEqual(r.addApplied, 1000000, '한도를 넘는 100만원은 추가한도로 인정');
  assert.strictEqual(r.deduction, 4000000, '소득공제 합계는 400만원');
});

test('기본 공제액과 추가 공제액이 모두 차면 기본한도+추가한도까지 인정', () => {
  // 신용 3,000만원(15%) + 전통시장 1,250만원(40%) → 총급여 5,000만원
  const r = cardDeduction({ grossSalary: 50000000, credit: 40000000, market: 22500000 });
  // 최저사용금액 1,250만원은 신용카드에서 먼저 소진 → 신용 2,750만원 × 15% = 412.5만원
  assert.strictEqual(r.baseAmount, 4125000);
  assert.strictEqual(r.addAmount, 9000000, '전통시장 2,250만원이 모두 문턱 위 → 40%');
  assert.strictEqual(r.baseApplied, 3000000);
  assert.strictEqual(r.excess, 10125000);
  assert.strictEqual(r.addApplied, 3000000, '추가한도 300만원이 상한');
  assert.strictEqual(r.deduction, 6000000, '기본 300만 + 추가 300만');
});

test('자녀 2명이면 400만원 + 300만원 = 700만원까지', () => {
  const r = cardDeduction({ grossSalary: 50000000, credit: 40000000, market: 22500000, children: 2 });
  assert.strictEqual(r.baseLimit, 4000000);
  assert.strictEqual(r.baseApplied, 4000000);
  assert.strictEqual(r.addApplied, 3000000);
  assert.strictEqual(r.deduction, 7000000);
});

test('추가한도는 시장·교통·문화 공제액만큼만 열린다 (체크카드 초과분은 사라짐)', () => {
  // 체크카드만 4,000만원: 최저 1,250만원 차감 → 2,750만원 × 30% = 825만원
  const r = cardDeduction({ grossSalary: 50000000, debit: 40000000 });
  assert.strictEqual(r.baseAmount, 8250000);
  assert.strictEqual(r.addAmount, 0);
  assert.strictEqual(r.baseApplied, 3000000);
  assert.strictEqual(r.addApplied, 0, '시장·교통·문화 사용분이 없으면 추가한도는 0원');
  assert.strictEqual(r.deduction, 3000000);
});

test('총급여 7,000만원 이하 자녀 0·1·2·3명 → 300·350·400·400만원', () => {
  const base = { grossSalary: 50000000, credit: 60000000 };
  assert.strictEqual(cardDeduction({ ...base, children: 0 }).baseLimit, 3000000);
  assert.strictEqual(cardDeduction({ ...base, children: 1 }).baseLimit, 3500000);
  assert.strictEqual(cardDeduction({ ...base, children: 2 }).baseLimit, 4000000);
  assert.strictEqual(cardDeduction({ ...base, children: 3 }).baseLimit, 4000000, '가산은 2명분까지만');
});

test('총급여 7,000만원 초과 자녀 0·1·2·3명 → 250·275·300·300만원', () => {
  const base = { grossSalary: 90000000, credit: 90000000 };
  assert.strictEqual(cardDeduction({ ...base, children: 0 }).baseLimit, 2500000);
  assert.strictEqual(cardDeduction({ ...base, children: 1 }).baseLimit, 2750000);
  assert.strictEqual(cardDeduction({ ...base, children: 2 }).baseLimit, 3000000);
  assert.strictEqual(cardDeduction({ ...base, children: 3 }).baseLimit, 3000000);
});

test('총급여 7,000만원 초과 구간의 추가한도는 200만원 (문화체육 제외)', () => {
  // 총급여 9,000만원 → 최저사용금액 2,250만원. 대중교통 2,250만 + 2,000만원.
  const r = cardDeduction({ grossSalary: 90000000, transit: 42500000, culture: 10000000 });
  assert.strictEqual(r.addLimit, 2000000);
  assert.strictEqual(r.addAmount, 8000000, '대중교통 2,000만원 × 40%');
  assert.strictEqual(r.addApplied, 2000000);
  assert.strictEqual(r.deduction, 4500000, '기본 250만 + 추가 200만');
});

test('총급여 정확히 7,000만원은 7,000만원 이하 구간(문화체육 30% 인정)', () => {
  const r = cardDeduction({ grossSalary: 70000000, culture: 20000000 });
  assert.strictEqual(r.creditEligible, true);
  assert.strictEqual(r.baseLimit, 3000000);
  assert.strictEqual(r.addLimit, 3000000);
  // 최저 1,750만원을 문화체육에서 차감 → 남은 250만원 × 30% = 75만원
  assert.strictEqual(r.addAmount, 750000);
  assert.strictEqual(r.deduction, 750000);
});

test('총급여 7,000만원 초과는 문화체육 사용분이 공제에서 빠진다', () => {
  const r = cardDeduction({ grossSalary: 70000001, culture: 20000000 });
  assert.strictEqual(r.creditEligible, false);
  assert.strictEqual(r.totalUsage, 0);
  assert.strictEqual(r.deduction, 0);
});

/* ------------------------------------------------------------------ *
 * ② 최저사용금액 차감 순서 (제2항 제6호)
 * ------------------------------------------------------------------ */
group('② 최저사용금액 차감 순서 (문화체육 → 전통시장·대중교통)');

test('문화체육이 전통시장보다 먼저 차감된다', () => {
  // 총급여 5,000만원 → 최저 1,250만원. 문화체육 1,000만원, 전통시장 500만원.
  const r = cardDeduction({ grossSalary: 50000000, culture: 10000000, market: 5000000 });
  // 문화체육 1,000만원 전액이 문턱에서 소진 → 전통시장 500만원 중 250만원만 차감
  assert.strictEqual(r.addAmount, 1000000, '전통시장 250만원 × 40% = 100만원');
  assert.strictEqual(r.deduction, 1000000);
});

test('문화체육 → 대중교통 순서도 같다', () => {
  const r = cardDeduction({ grossSalary: 50000000, culture: 10000000, transit: 5000000 });
  assert.strictEqual(r.addAmount, 1000000);
});

test('신용 → 체크·현금 → 문화체육 순서', () => {
  // 신용 800만, 현금 300만, 문화체육 500만, 총급여 5,000만(최저 1,250만)
  const r = cardDeduction({ grossSalary: 50000000, credit: 8000000, cash: 3000000, culture: 5000000 });
  // 신용 800만 소진(남 450만) → 현금 300만 소진(남 150만) → 문화체육 350만만 인정
  assert.strictEqual(r.baseAmount, 0, '신용카드·현금영수증은 문턱 안에서 모두 소진');
  assert.strictEqual(r.addAmount, 3500000 * 0.3, '문화체육 350만원 × 30%');
  assert.strictEqual(Math.round(r.deduction), 1050000);
});

test('문화체육이 문턱을 다 채우면 전통시장·대중교통은 전액 공제 대상', () => {
  // 총급여 4,000만원 → 최저 1,000만원. 문화체육 1,000만원 + 전통시장 800만원.
  const r = cardDeduction({ grossSalary: 40000000, culture: 10000000, market: 8000000 });
  assert.strictEqual(r.addAmount, 3200000, '전통시장 800만원 × 40%');
  assert.strictEqual(r.deduction, 3200000);
});

/* ------------------------------------------------------------------ *
 * ③ 하위 호환·통합
 * ------------------------------------------------------------------ */
group('③ 하위 호환·통합');

test('legacy 키 childrenUnder18도 같은 결과', () => {
  const a = cardDeduction({ grossSalary: 50000000, credit: 60000000, childrenUnder18: 2 });
  const b = cardDeduction({ grossSalary: 50000000, credit: 60000000, children: 2 });
  assert.strictEqual(a.deduction, b.deduction);
  assert.strictEqual(a.baseLimit, 4000000);
  assert.strictEqual(a.childrenUnder18, 2);
});

test('문자열·쉼표 입력도 처리', () => {
  const r = cardDeduction({ grossSalary: '50,000,000', market: '22,500,000', children: '2' });
  assert.strictEqual(r.deduction, 4000000);
});

test('연말정산 계산에 자녀 수가 반영된다 (NaN 없음)', () => {
  const r = LifeCalc.yearEndTax({ grossSalary: 50000000, credit: 40000000, market: 22500000, children: 2 });
  assert.strictEqual(r.card.baseLimit, 4000000);
  assert.strictEqual(r.card.deduction, 7000000);
  assert.ok(Number.isFinite(r.refundWithLocal));
  assert.ok(Number.isFinite(r.incomeDeduction.total));
});

test('사용액이 최저사용금액 이하면 공제 0원', () => {
  const r = cardDeduction({ grossSalary: 50000000, credit: 10000000 });
  assert.strictEqual(r.deduction, 0);
});

/* ------------------------------------------------------------------ */
console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') + ' — ' + passed + '개 통과, ' + failed + '개 실패');
if (failed > 0) {
  failures.forEach((f) => console.log('  · ' + f.name + ': ' + f.message));
  process.exit(1);
}
