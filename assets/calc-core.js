/*!
 * 생활 계산소 - 계산 엔진 (calc-core.js)
 * 순수 함수만 담당합니다. DOM을 건드리지 않으므로 브라우저와 Node 테스트에서 그대로 실행됩니다.
 *
 * 기준: 2026년 확정 법령·고시 (2026년 11월 확인)
 *  - 최저임금 시급 10,320원 / 월 209시간 2,156,880원
 *  - 구직급여 상한 68,100원, 하한 66,048원 (2026.1.1 이후 이직, 1일 8시간)
 *  - 국민연금 4.75%(2026.7~), 건강보험 3.595%, 장기요양 건보료의 13.14%, 고용보험 0.9%
 *  - 소득세율 6~45%, 근로소득공제·인적공제·근로소득세액공제·자녀세액공제
 *  - 신용카드 등 소득공제: 총급여 25% 초과분, 신용 15%·체크/현금 30%·전통시장/대중교통 40%·문화체육 30%
 */
(function (global) {
  'use strict';

  var YEAR = 2026;

  var RATES = {
    minimumWage: 10320,
    monthlyHours: 209,
    pension: { employee: 0.0475, minBase: 410000, maxBase: 6590000 },
    health: { employee: 0.03595 },
    ltc: { ofHealth: 0.1314 },
    employment: { employee: 0.009 },
    localTaxRate: 0.1
  };

  // 2026년 종합소득세율 (소득세법 제55조)
  var TAX_BRACKETS = [
    { limit: 14000000, rate: 0.06, deduction: 0 },
    { limit: 50000000, rate: 0.15, deduction: 1260000 },
    { limit: 88000000, rate: 0.24, deduction: 5760000 },
    { limit: 150000000, rate: 0.35, deduction: 15440000 },
    { limit: 300000000, rate: 0.38, deduction: 19940000 },
    { limit: 500000000, rate: 0.4, deduction: 25940000 },
    { limit: 1000000000, rate: 0.42, deduction: 35940000 },
    { limit: Infinity, rate: 0.45, deduction: 65940000 }
  ];

  var UNEMPLOYMENT = {
    dailyCap: 68100,
    minHourlyWage: 10320,
    ratio: 0.6,
    floorRatio: 0.8
  };

  var CARD = {
    thresholdRate: 0.25,
    credit: 0.15,
    debit: 0.3,
    market: 0.4,
    transit: 0.4,
    culture: 0.3,
    cultureSalaryLimit: 70000000,
    baseLimits: {
      low: [3000000, 3500000, 4000000], // 총급여 7,000만 이하: 자녀 0·1·2명 이상
      high: [2500000, 2750000, 3000000] // 총급여 7,000만 초과
    },
    addLimitLow: 3000000,
    addLimitHigh: 2000000
  };

  /* ---------------------------------------------------------------- *
   * 공통 유틸
   * ---------------------------------------------------------------- */

  function toNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    if (value === null || value === undefined || value === '') return 0;
    var n = Number(String(value).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function floor10(value) {
    return Math.floor(value / 10 + 1e-7) * 10;
  }

  function clamp(value, lo, hi) {
    return Math.min(Math.max(value, lo), hi);
  }

  function round(value) {
    return Math.round(value + 1e-7);
  }

  /* ---------------------------------------------------------------- *
   * 1. 신용카드 등 사용금액 소득공제 (조세특례제한법 제126조의2)
   * ---------------------------------------------------------------- */

  function cardDeduction(opts) {
    var o = opts || {};
    var gross = Math.max(0, toNumber(o.grossSalary));
    var children = Math.max(0, Math.floor(toNumber(o.childrenUnder18)));
    var credit = Math.max(0, toNumber(o.credit));
    var debit = Math.max(0, toNumber(o.debit));
    var cash = Math.max(0, toNumber(o.cash));
    var market = Math.max(0, toNumber(o.market));
    var transit = Math.max(0, toNumber(o.transit));
    var culture = Math.max(0, toNumber(o.culture));

    var isLow = gross <= CARD.cultureSalaryLimit;
    if (!isLow) culture = 0; // 문화체육 30%는 총급여 7,000만원 이하만

    var total = credit + debit + cash + market + transit + culture;
    var threshold = gross * CARD.thresholdRate;

    // 최저사용금액은 공제율이 낮은 결제수단부터 차감한다.
    var remaining = threshold;
    function consume(amount) {
      var used = Math.min(amount, remaining);
      remaining -= used;
      return amount - used;
    }
    var cCredit = consume(credit);
    var cDebit = consume(debit);
    var cCash = consume(cash);
    var cMarket = consume(market);
    var cTransit = consume(transit);
    var cCulture = consume(culture);

    var baseAmount = cCredit * CARD.credit + (cDebit + cCash) * CARD.debit;
    var addAmount = cMarket * CARD.market + cTransit * CARD.transit + cCulture * CARD.culture;

    var tier = children >= 2 ? 2 : children;
    var baseLimit = (isLow ? CARD.baseLimits.low : CARD.baseLimits.high)[tier];
    var addLimit = isLow ? CARD.addLimitLow : CARD.addLimitHigh;

    var baseApplied = Math.min(baseAmount, baseLimit);
    var addApplied = Math.min(addAmount, addLimit);

    return {
      gross: gross,
      totalUsage: total,
      threshold: threshold,
      overThreshold: Math.max(0, total - threshold),
      childrenUnder18: children,
      baseLimit: baseLimit,
      addLimit: addLimit,
      baseAmount: baseAmount,
      addAmount: addAmount,
      baseApplied: baseApplied,
      addApplied: addApplied,
      deduction: baseApplied + addApplied,
      creditEligible: isLow
    };
  }

  /* ---------------------------------------------------------------- *
   * 2. 근로소득공제·세율·세액공제 기본 (소득세법)
   * ---------------------------------------------------------------- */

  function workIncomeDeduction(grossAnnual) {
    var g = Math.max(0, grossAnnual);
    if (g <= 5000000) return g * 0.7;
    if (g <= 15000000) return 3500000 + (g - 5000000) * 0.4;
    if (g <= 45000000) return 7500000 + (g - 15000000) * 0.15;
    if (g <= 100000000) return 12000000 + (g - 45000000) * 0.05;
    return Math.min(14750000 + (g - 100000000) * 0.02, 20000000);
  }

  function progressiveTax(taxBase) {
    var base = Math.max(0, taxBase);
    for (var i = 0; i < TAX_BRACKETS.length; i++) {
      if (base <= TAX_BRACKETS[i].limit) {
        return Math.max(0, base * TAX_BRACKETS[i].rate - TAX_BRACKETS[i].deduction);
      }
    }
    return 0;
  }

  function workTaxCreditLimit(grossAnnual) {
    var g = grossAnnual;
    if (g <= 33000000) return 740000;
    if (g <= 70000000) return Math.max(660000, 740000 - (g - 33000000) * 0.008);
    if (g <= 120000000) return Math.max(500000, 660000 - (g - 70000000) * 0.5);
    return Math.max(200000, 500000 - (g - 120000000) * 0.5);
  }

  function workTaxCredit(calculatedTax, grossAnnual) {
    if (calculatedTax <= 0) return 0;
    var raw =
      calculatedTax <= 1300000 ? calculatedTax * 0.55 : 715000 + (calculatedTax - 1300000) * 0.3;
    return Math.max(0, Math.min(raw, workTaxCreditLimit(grossAnnual)));
  }

  function childTaxCredit(children) {
    var n = Math.max(0, Math.floor(toNumber(children)));
    if (n <= 0) return 0;
    if (n === 1) return 250000;
    if (n === 2) return 550000;
    return 550000 + (n - 2) * 400000;
  }

  /* ---------------------------------------------------------------- *
   * 3. 연말정산 (2026년 귀속) - 소득공제·세액공제·환급액 추정
   * ---------------------------------------------------------------- */

  var TAX = {
    personalDeduction: 1500000,
    medicalThresholdRate: 0.03,
    medicalGeneralLimit: 7000000,
    medicalRate: 0.15,
    educationSchoolLimit: 3000000,
    educationCollegeLimit: 9000000,
    educationRate: 0.15,
    insuranceLimit: 1000000,
    insuranceRate: 0.12,
    pensionLimit: 9000000,
    pensionRateLow: 0.15,
    pensionSalaryLimit: 55000000,
    pensionRateHigh: 0.12,
    rentLimit: 10000000,
    rentSalaryLimit: 80000000,
    rentRateLow: 0.17,
    rentRateHigh: 0.15,
    donationThreshold: 10000000,
    donationRate: 0.15,
    donationRateHigh: 0.3,
    standardCredit: 130000
  };

  function yearEndTax(opts) {
    var o = opts || {};
    var gross = Math.max(0, toNumber(o.grossSalary));
    var dependents = Math.max(0, Math.floor(toNumber(o.dependents)));
    var children9 = Math.max(0, Math.floor(toNumber(o.childrenTaxCredit)));
    var children18 = Math.max(0, Math.floor(toNumber(o.childrenUnder18)));
    var schoolChildren = Math.max(0, Math.floor(toNumber(o.schoolChildren)));

    var card = cardDeduction(o);

    // 소득공제
    var earnedDeduction = workIncomeDeduction(gross);
    var personal = TAX.personalDeduction * (1 + dependents);
    var pensionBaseMonthly = Math.min(gross / 12, RATES.pension.maxBase);
    var nationalPension = Math.max(0, pensionBaseMonthly * RATES.pension.employee * 12);
    // 근로자 부담 건강보험 + 장기요양 + 고용보험 (소득 기준 추정)
    var socialInsurance =
      gross * (RATES.health.employee + RATES.health.employee * RATES.ltc.ofHealth + RATES.employment.employee);

    var incomeDeduction = earnedDeduction + personal + nationalPension + socialInsurance + card.deduction;
    var taxBase = Math.max(0, gross - incomeDeduction);
    var calculatedTax = progressiveTax(taxBase);

    // 세액공제 (특별세액공제)
    var pensionPaid = Math.max(0, toNumber(o.pensionAccount));
    var pensionRate = gross <= TAX.pensionSalaryLimit ? TAX.pensionRateLow : TAX.pensionRateHigh;
    var pensionCredit = Math.min(pensionPaid, TAX.pensionLimit) * pensionRate;

    var insuranceCredit = Math.min(Math.max(0, toNumber(o.insurancePremium)), TAX.insuranceLimit) * TAX.insuranceRate;

    var medicalPaid = Math.max(0, toNumber(o.medical));
    var medicalBase = Math.max(0, medicalPaid - gross * TAX.medicalThresholdRate);
    var medicalCredit = Math.min(medicalBase, TAX.medicalGeneralLimit) * TAX.medicalRate;

    var schoolPaid = Math.max(0, toNumber(o.educationSchool));
    var collegePaid = Math.max(0, toNumber(o.educationCollege));
    var schoolCap = TAX.educationSchoolLimit * Math.max(1, schoolChildren);
    var educationBase = Math.min(schoolPaid, schoolCap) + Math.min(collegePaid, TAX.educationCollegeLimit * Math.max(0, Math.floor(toNumber(o.collegeChildren))));
    var educationCredit = educationBase * TAX.educationRate;

    var donation = Math.max(0, toNumber(o.donation));
    var donationCredit =
      Math.min(donation, TAX.donationThreshold) * TAX.donationRate +
      Math.max(0, donation - TAX.donationThreshold) * TAX.donationRateHigh;

    var rent = Math.max(0, toNumber(o.rent));
    var rentCredit = 0;
    var rentApplied = 0;
    if (gross <= TAX.rentSalaryLimit && rent > 0) {
      rentApplied = Math.min(rent, TAX.rentLimit);
      rentCredit = rentApplied * (gross <= TAX.pensionSalaryLimit ? TAX.rentRateLow : TAX.rentRateHigh);
    }

    var specialCreditSum = insuranceCredit + medicalCredit + educationCredit + donationCredit + rentCredit;
    var childCredit = childTaxCredit(children9);

    // 시나리오 A: 특별소득공제(건강보험료 등)와 특별세액공제를 모두 받는 경우
    var creditA = specialCreditSum + pensionCredit + childCredit + workTaxCredit(calculatedTax, gross);
    var decisionA = Math.max(0, calculatedTax - creditA);

    // 시나리오 B: 표준세액공제(13만원)만 받는 경우 (건강보험료 공제·특별세액공제·월세 공제 포기)
    var taxBaseB = Math.max(0, gross - (earnedDeduction + personal + nationalPension + card.deduction));
    var calculatedB = progressiveTax(taxBaseB);
    var creditB = TAX.standardCredit + pensionCredit + childCredit + workTaxCredit(calculatedB, gross);
    var decisionB = Math.max(0, calculatedB - creditB);

    var useStandard = decisionB < decisionA - 1;
    var determinedTax = useStandard ? decisionB : decisionA;

    // 기납부(원천징수) 추정: 간이세액표 방식을 단순화 (인적공제·국민연금만 반영)
    var withholdingBase = Math.max(0, gross - earnedDeduction - personal - nationalPension);
    var withholdingTax = progressiveTax(withholdingBase);
    var withholdingCredit = workTaxCredit(withholdingTax, gross) + childCredit;
    var estimatedWithheld = Math.max(0, Math.floor(withholdingTax - withholdingCredit));

    var prepaid = toNumber(o.prepaidTax);
    var prepaidApplied = prepaid > 0 ? prepaid : estimatedWithheld;
    var prepaidIsEstimate = !(prepaid > 0);

    var refund = prepaidApplied - determinedTax;
    var refundWithLocal = refund * (1 + RATES.localTaxRate);

    return {
      year: YEAR,
      gross: gross,
      card: card,
      incomeDeduction: {
        earned: Math.round(earnedDeduction),
        personal: personal,
        nationalPension: Math.round(nationalPension),
        socialInsurance: Math.round(socialInsurance),
        card: card.deduction,
        total: Math.round(useStandard ? earnedDeduction + personal + nationalPension + card.deduction : incomeDeduction)
      },
      taxBase: Math.round(useStandard ? taxBaseB : taxBase),
      calculatedTax: Math.round(useStandard ? calculatedB : calculatedTax),
      credits: {
        pension: Math.round(pensionCredit),
        insurance: Math.round(insuranceCredit),
        medical: Math.round(medicalCredit),
        education: Math.round(educationCredit),
        donation: Math.round(donationCredit),
        rent: Math.round(rentCredit),
        rentApplied: Math.round(rentApplied),
        child: childCredit,
        work: Math.round(workTaxCredit(useStandard ? calculatedB : calculatedTax, gross)),
        standard: useStandard ? TAX.standardCredit : 0,
        total: Math.round(useStandard ? creditB : creditA)
      },
      specialCreditSum: Math.round(specialCreditSum),
      usedStandardCredit: useStandard,
      determinedTax: Math.round(determinedTax),
      localTax: Math.round(determinedTax * RATES.localTaxRate),
      determinedTotal: Math.round(determinedTax * (1 + RATES.localTaxRate)),
      prepaid: Math.round(prepaidApplied),
      prepaidIsEstimate: prepaidIsEstimate,
      refund: Math.round(refund),
      refundWithLocal: Math.round(refundWithLocal),
      effectiveRate: gross > 0 ? determinedTax / gross : 0
    };
  }

  /* ---------------------------------------------------------------- *
   * 4. 구직급여(실업급여) - 2026년 이직 기준
   * ---------------------------------------------------------------- */

  function benefitDays(age, insuredYears, disabled) {
    var y = Math.max(0, toNumber(insuredYears));
    var over50 = toNumber(age) >= 50 || !!disabled;
    if (y < 1) return 120;
    if (y < 3) return over50 ? 180 : 150;
    if (y < 5) return over50 ? 210 : 180;
    if (y < 10) return over50 ? 240 : 210;
    return over50 ? 270 : 240;
  }

  function unemployment(opts) {
    var o = opts || {};
    var wage3m = Math.max(0, toNumber(o.wage3m));
    var days = Math.max(1, toNumber(o.periodDays) || 92);
    var dailyHours = clamp(toNumber(o.dailyHours) || 8, 1, 12);
    var age = toNumber(o.age);
    var insured = toNumber(o.insuredYears);
    var disabled = !!o.disabled;

    var dailyAverage = wage3m / days;
    var raw = dailyAverage * UNEMPLOYMENT.ratio;
    var floor = UNEMPLOYMENT.minHourlyWage * UNEMPLOYMENT.floorRatio * dailyHours;
    var cap = UNEMPLOYMENT.dailyCap;

    var applied = '평균임금의 60%';
    var dailyBenefit = raw;
    if (raw < floor) {
      dailyBenefit = floor;
      applied = '하한액';
    } else if (raw > cap) {
      dailyBenefit = cap;
      applied = '상한액';
    }
    dailyBenefit = Math.floor(dailyBenefit);

    var days_ = benefitDays(age, insured, disabled);
    var total = dailyBenefit * days_;

    return {
      dailyAverage: Math.round(dailyAverage),
      rawBenefit: Math.round(raw),
      dailyBenefit: dailyBenefit,
      applied: applied,
      floor: Math.round(floor),
      cap: cap,
      benefitDays: days_,
      total: total,
      monthly: Math.floor(dailyBenefit * 30),
      waitingDays: 7
    };
  }

  /* ---------------------------------------------------------------- *
   * 5. 주휴수당·시급·월급 (근로기준법 제55조, 시행령 제30조)
   * ---------------------------------------------------------------- */

  var WEEKS_PER_MONTH = 365 / 12 / 7; // 4.3452...

  function weeklyHoliday(opts) {
    var o = opts || {};
    var hourly = Math.max(0, toNumber(o.hourlyWage));
    var dailyHours = clamp(toNumber(o.dailyHours) || 8, 1, 24);
    var weeklyDays = clamp(toNumber(o.weeklyDays) || 5, 1, 7);

    var weeklyContractHours = dailyHours * weeklyDays;
    var eligible = weeklyContractHours >= 15;
    var holidayHours = eligible ? Math.min(8, (weeklyContractHours / 40) * 8) : 0;
    var holidayPay = holidayHours * hourly;
    var weeklyPay = weeklyContractHours * hourly;
    // 월 소정근로시간: (주 소정근로 + 주휴) × 4.345주. 급여 실무와 최저임금 고시에 맞춰 시간은 반올림한다(주 40시간 → 209시간).
    var monthlyHoursExact = (weeklyContractHours + holidayHours) * WEEKS_PER_MONTH;
    var monthlyHours = Math.round(monthlyHoursExact);
    var monthlyPay = Math.round(monthlyHours * hourly);
    var annualPay = monthlyPay * 12;

    return {
      hourlyWage: hourly,
      dailyHours: dailyHours,
      weeklyDays: weeklyDays,
      weeklyContractHours: weeklyContractHours,
      eligible: eligible,
      holidayHours: Math.round(holidayHours * 100) / 100,
      holidayPay: Math.round(holidayPay),
      weeklyPay: Math.round(weeklyPay),
      weeklyTotal: Math.round(weeklyPay + holidayPay),
      monthlyHours: monthlyHours,
      monthlyPay: monthlyPay,
      annualPay: annualPay,
      belowMinimum: hourly > 0 && hourly < RATES.minimumWage
    };
  }

  function hourlyFromMonthly(monthlyPay, dailyHours, weeklyDays) {
    var pay = Math.max(0, toNumber(monthlyPay));
    var hours = clamp(toNumber(dailyHours) || 8, 1, 24) * clamp(toNumber(weeklyDays) || 5, 1, 7);
    var holiday = hours >= 15 ? Math.min(8, (hours / 40) * 8) : 0;
    var totalHours = Math.round((hours + holiday) * WEEKS_PER_MONTH);
    return totalHours > 0 ? Math.round(pay / totalHours) : 0;
  }

  /* ---------------------------------------------------------------- *
   * 6. 대출 상환
   * ---------------------------------------------------------------- */

  function loan(opts) {
    var o = opts || {};
    var principal = Math.max(0, toNumber(o.principal));
    var annualRate = Math.max(0, toNumber(o.annualRate)) / 100;
    var months = Math.max(1, Math.floor(toNumber(o.months)));
    var method = o.method || 'equalPayment';

    var r = annualRate / 12;
    var rows = [];
    var totalInterest = 0;
    var monthlyPayment = 0;
    var balance = principal;

    if (method === 'equalPayment') {
      monthlyPayment = r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
      for (var i = 1; i <= months; i++) {
        var interest = balance * r;
        var principalPart = monthlyPayment - interest;
        if (i === months) {
          principalPart = balance;
        }
        balance = Math.max(0, balance - principalPart);
        totalInterest += interest;
        rows.push({ month: i, payment: principalPart + interest, principal: principalPart, interest: interest, balance: balance });
      }
    } else if (method === 'equalPrincipal') {
      var principalPartFixed = principal / months;
      for (var j = 1; j <= months; j++) {
        var interest2 = balance * r;
        balance = Math.max(0, balance - principalPartFixed);
        totalInterest += interest2;
        rows.push({ month: j, payment: principalPartFixed + interest2, principal: principalPartFixed, interest: interest2, balance: balance });
      }
      monthlyPayment = rows[0].payment;
    } else {
      // 만기일시상환: 매월 이자만, 만기에 원금
      var interest3 = principal * r;
      monthlyPayment = interest3;
      for (var k = 1; k <= months; k++) {
        var pay = k === months ? interest3 + principal : interest3;
        totalInterest += interest3;
        rows.push({ month: k, payment: pay, principal: k === months ? principal : 0, interest: interest3, balance: k === months ? 0 : principal });
      }
    }

    return {
      principal: principal,
      annualRate: annualRate * 100,
      months: months,
      method: method,
      firstPayment: Math.round(rows[0].payment),
      lastPayment: Math.round(rows[rows.length - 1].payment),
      monthlyPayment: Math.round(monthlyPayment),
      totalInterest: Math.round(totalInterest),
      totalPayment: Math.round(principal + totalInterest),
      rows: rows
    };
  }

  var LifeCalc = {
    YEAR: YEAR,
    RATES: RATES,
    TAX: TAX,
    TAX_BRACKETS: TAX_BRACKETS,
    UNEMPLOYMENT: UNEMPLOYMENT,
    CARD: CARD,
    toNumber: toNumber,
    floor10: floor10,
    progressiveTax: progressiveTax,
    workIncomeDeduction: workIncomeDeduction,
    workTaxCredit: workTaxCredit,
    workTaxCreditLimit: workTaxCreditLimit,
    childTaxCredit: childTaxCredit,
    cardDeduction: cardDeduction,
    yearEndTax: yearEndTax,
    benefitDays: benefitDays,
    unemployment: unemployment,
    weeklyHoliday: weeklyHoliday,
    hourlyFromMonthly: hourlyFromMonthly,
    loan: loan
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LifeCalc;
  global.LifeCalc = LifeCalc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
