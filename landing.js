'use strict';

/* Public landing page behaviour: language switch (shares the tool's saved
 * language preference), mobile navigation, a "continue your case" hint and
 * the optional official-award link. It reads no clinical content: the case
 * hint only checks whether a saved case exists in this browser. No network
 * requests, no analytics. Spanish text lives in index.html; this file holds
 * the English dictionary and caches the Spanish originals at load time. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.init(root.document);
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var LS_LANG_KEY = 'hiv_cascade_lang';   /* same key as app.js */
  var LS_CASE_KEY = 'hiv_cascade_state';  /* same key as app.js */

  var EN = {
    meta_description: 'A decision-support tool for medication review that identifies possible prescribing cascades in people living with HIV. Local in-browser processing; no clinical data is sent anywhere.',
    skip_link: 'Skip to main content',
    brand_label: 'HIV Prescribing Cascade Auditor — home',
    menu_label: 'Menu',
    nav_label: 'Sections',
    nav_problem: 'The problem',
    nav_how: 'How it works',
    nav_features: 'Features',
    nav_privacy: 'Privacy',
    nav_award: 'Recognition',
    nav_team: 'Authorship',
    language_selector: 'Language selection',
    cta_access_short: 'Open tool',
    hero_award: 'First Prize · XII SEFH/CSL Awards',
    hero_subtitle: 'Technology applied to the detection and assessment of prescribing cascades in people living with HIV',
    hero_lead: 'A medication-review support tool that checks a case’s medicines and clinical problems against a curated knowledge base, and presents each possible cascade with the evidence behind it for professional assessment.',
    cta_access: 'Open the tool',
    cta_learn: 'About the project',
    resume_text: 'There is a case in progress saved in this browser.',
    resume_link: 'Continue the review',
    fact_local: 'Local processing in the browser',
    fact_nodata: 'No clinical data sent anywhere',
    fact_bilingual: 'Spanish and English',
    mock_workflow: 'Review workflow',
    mock_s1: 'Data', mock_s2: 'Medications', mock_s3: 'Classification', mock_s4: 'Cascades', mock_s5: 'Plan', mock_s6: 'Report',
    mock_title: 'Calcium Channel Blocker → Ankle Edema → Diuretic',
    chain_index: 'Index drug',
    chain_ade: 'Intermediate problem',
    chain_cascade: 'Subsequent drug',
    mock_ade: 'Ankle/leg edema',
    dim_rel: 'Potential clinical relevance (literature/KB)',
    dim_rel_v: 'high',
    dim_kb: 'Knowledge validation status',
    dim_kb_v: 'Reviewed literature source',
    dim_auto: 'Automated assessment of this case',
    dim_auto_v: 'Possible cascade with sufficient evidence for review',
    dim_prof: 'Professional validation',
    dim_prof_v: 'Pending professional review',
    mock_caption: 'Actual output for the pseudonymised demo case bundled with the tool.',
    problem_eyebrow: 'The clinical problem',
    problem_title: 'When an adverse effect is treated as a new disease',
    problem_p1: 'A <strong>prescribing cascade</strong> occurs when the adverse effect of one drug is interpreted as a new clinical problem and treated with another drug, instead of reconsidering the first one.',
    problem_p2: 'In people living with HIV, antiretroviral therapy often coexists with medicines for cardiovascular, metabolic or bone comorbidities. Pharmacokinetic interactions — particularly CYP3A4-mediated ones involving boosters such as ritonavir or cobicistat — add a further layer of complexity.',
    problem_p3: 'With polypharmacy, the sequence linking both drugs is scattered across notes, dates and different prescribers, and is hard to recognise in a routine review. A tool that brings that information together in a structured way helps the professional ask the right question; the answer remains a clinical one.',
    fig_caption: 'Canonical example',
    fig_k1: 'Drug A', fig_v1: 'Amlodipine, for hypertension',
    fig_k2: 'Adverse effect', fig_v2: 'Ankle oedema',
    fig_k3: 'Drug B', fig_v3: 'Furosemide, prescribed for the oedema',
    fig_note: 'The oedema may be caused by the antihypertensive itself: the diuretic adds medication without addressing the cause.',
    how_eyebrow: 'How it works',
    how_title: 'A traceable review workflow, from note to report',
    how_lead: 'Every step records what was detected, what the professional corrected and why the system rates each signal as it does.',
    how_1_t: 'Medication information',
    how_1_b: 'A pseudonymised clinical note is pasted in. Local rules identify the medication — including fixed-dose combinations, broken down into their active ingredients — clinical problems with their status, and simple measurements.',
    how_2_t: 'Professional review of the input',
    how_2_b: 'The pharmacist reviews and corrects the extracted medications and problems before the analysis. Only a confirmed review is applied to the reasoning, and it is recorded in the report.',
    how_3_t: 'Analysis against the knowledge base',
    how_3_b: 'Each index drug → intermediate problem → subsequent drug sequence is checked against general and HIV-specific rules, verifying whether the problem is documented, negated, historical, or has an alternative indication.',
    how_4_t: 'Professional assessment and report',
    how_4_b: 'The system never marks a cascade as confirmed: it proposes prudent assessment levels. The professional records their own judgement on each signal and generates an exportable report.',
    how_disclaimer: 'A clinical decision-support tool. It is not an autonomous diagnostic system and does not issue prescriptions.',
    feat_eyebrow: 'Features',
    feat_title: 'What is available today',
    f1_t: 'Detection of possible cascades',
    f1_b: 'Two complementary mechanisms: drug–drug sequences and symptom bridges (a symptom that may be an adverse effect of one drug and is treated by another).',
    f2_t: 'HIV-specific context',
    f2_b: 'Rules specific to antiretroviral pharmacology and interaction warnings attached to each cascade, such as those involving pharmacokinetic boosters.',
    f3_t: 'Four-dimension traceability',
    f3_b: 'Potential relevance, literature validation of the rule, automated assessment of the case and professional validation, always kept separate and shown with the evidence for each signal.',
    f4_t: 'Browsable knowledge base',
    f4_b: 'Curated, versioned rules with references where available and an explicit review status. A read-only catalogue lets you browse them inside the tool.',
    f5_t: 'Medication-wide alerts',
    f5_b: 'Findings that depend on the whole regimen — anticholinergic burden, CNS-depressant burden or NSAID duplication — shown separately from cascades.',
    f6_t: 'Reports and exports',
    f6_b: 'Text ready for the medical record, PDF printing, JSON and CSV export for research, and import of saved cases.',
    f7_t: 'Local processing',
    f7_b: 'All analysis runs in the browser. It works offline once loaded and needs no installation or application server.',
    f8_t: 'Bilingual',
    f8_b: 'Interface, reports and knowledge base in Spanish and English.',
    priv_eyebrow: 'Security and privacy',
    priv_title: 'Designed so that clinical data never leaves the browser',
    priv_lead: 'Guarantees that can be verified in the tool’s source code, and limits worth knowing.',
    g1_t: 'Local processing',
    g1_b: 'Extraction and analysis run in the browser. There is no project backend.',
    g2_t: 'No clinical data sent',
    g2_b: 'No calls to external AI models, no telemetry, no analytics. The content security policy restricts connections to the site itself.',
    g3_t: 'Pseudonymisation',
    g3_b: 'Designed for pseudonymised notes. The tool does not detect identifiers automatically: removing names, record numbers or other identifying data is the user’s responsibility.',
    g4_t: 'Professional validation',
    g4_b: 'No finding is treated as confirmed without the professional’s explicit judgement, which is recorded separately from the automated assessment.',
    lim_title: 'Known limits',
    lim_1: 'The case is stored unencrypted in the browser’s local storage. Use professional devices and delete the data when you finish.',
    lim_2: 'The knowledge base is not exhaustive and some of its rules are pending literature review.',
    lim_3: 'It does not replace clinical judgement or current guidelines. Its regulatory qualification is under assessment; it does not bear CE marking.',
    award_eyebrow: 'Research and recognition',
    award_section_title: 'A project recognised for its contribution to patient safety',
    laurel_kicker: 'First prize',
    laurel_title: '1.<sup>er</sup> Premio — XII Premios SEFH/CSL sobre Calidad de los Servicios de Farmacia y Seguridad en el Uso de los Medicamentos <span class="lang-note">(official Spanish title: First Prize, XII SEFH/CSL Awards for Quality of Pharmacy Services and Safety in the Use of Medicines)</span>',
    laurel_project_label: 'Awarded project',
    laurel_project: '«Mejora de la seguridad farmacoterapéutica en personas que viven con VIH mediante una herramienta digital basada en inteligencia artificial para la detección y abordaje de cascadas terapéuticas»',
    laurel_note: 'The recognition was granted to the research project within which this tool is developed. It is not a clinical validation or a regulatory certification of the software.',
    laurel_link: 'View the official announcement',
    r1_t: 'Research basis',
    r1_b: 'Doctoral thesis “Usefulness of the SANPAT tool for preventing prescribing cascades in older people living with HIV”.',
    r2_t: 'Ethics committee',
    r2_b: 'Approval code SICEIA-2025-002829.',
    r3_t: 'Intellectual property',
    r3_b: 'Computer program registered with the Spanish Intellectual Property Registry, entry 04/2026/2614.',
    team_eyebrow: 'Team and authorship',
    team_title: 'Project authorship',
    person_role: 'Co-author and co-owner of the tool',
    access_title: 'Start a review',
    access_text: 'No installation or sign-up. A pseudonymised demo case is included so you can walk through the full workflow in a few minutes.',
    access_req: 'A modern browser (up-to-date Chrome, Edge, Firefox or Safari).',
    footer_disclaimer: 'A clinical decision-support tool under evaluation. It is not medical advice, diagnosis or prescription. All results must be reviewed by a qualified healthcare professional.',
    footer_nav: 'Footer',
    footer_kb: 'Knowledge base',
    footer_about: 'About the project',
    footer_legal: '© HIV Prescribing Cascade Auditor · v1.0.0 · Ramón Morillo Verdugo and Cecilia Solís Martín. Computer program registered with the Spanish Intellectual Property Registry, entry 04/2026/2614.'
  };

  var ATTRS = [
    ['data-i18n', null],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-content', 'content']
  ];

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* storage unavailable: preference not kept */ }
  }

  function applyLanguage(doc, lang) {
    ATTRS.forEach(function (pair) {
      doc.querySelectorAll('[' + pair[0] + ']').forEach(function (el) {
        var key = el.getAttribute(pair[0]);
        var cacheAttr = 'data-es-' + (pair[1] || 'html');
        if (!el.hasAttribute(cacheAttr)) {
          el.setAttribute(cacheAttr, pair[1] ? (el.getAttribute(pair[1]) || '') : el.innerHTML);
        }
        var value = lang === 'en' && Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : el.getAttribute(cacheAttr);
        if (pair[1]) el.setAttribute(pair[1], value);
        else el.innerHTML = value;
      });
    });
    doc.documentElement.lang = lang;
    doc.querySelectorAll('[data-lang]').forEach(function (btn) {
      var active = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('lang-btn-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function hasSavedCase() {
    var raw = storageGet(LS_CASE_KEY);
    if (!raw) return false;
    try {
      var parsed = JSON.parse(raw);
      return !!(parsed && typeof parsed.clinicalNote === 'string' && parsed.clinicalNote.trim());
    } catch (e) { return false; }
  }

  function init(doc) {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', function () { init(doc); });
      return;
    }
    var saved = storageGet(LS_LANG_KEY);
    if (saved === 'en') applyLanguage(doc, 'en');
    doc.querySelectorAll('[data-lang]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var lang = btn.getAttribute('data-lang') === 'en' ? 'en' : 'es';
        applyLanguage(doc, lang);
        storageSet(LS_LANG_KEY, lang);
      });
    });

    var toggle = doc.getElementById('site-nav-toggle');
    var nav = doc.getElementById('site-nav');
    if (toggle && nav) {
      var setOpen = function (open) {
        toggle.setAttribute('aria-expanded', String(open));
        nav.classList.toggle('is-open', open);
      };
      toggle.addEventListener('click', function () { setOpen(toggle.getAttribute('aria-expanded') !== 'true'); });
      nav.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
      doc.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setOpen(false); toggle.focus(); }
      });
    }

    var resume = doc.getElementById('resume-case');
    if (resume && hasSavedCase()) resume.hidden = false;

    var cfg = window.SITE_CONFIG || {};
    var awardLink = doc.getElementById('award-link');
    if (awardLink && /^https:\/\//i.test(cfg.awardUrl || '')) {
      awardLink.href = cfg.awardUrl;
      awardLink.rel = 'noopener noreferrer';
      awardLink.target = '_blank';
      awardLink.hidden = false;
    }

    var header = doc.querySelector('.site-header');
    if (header) {
      var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  }

  return { EN: EN, init: init };
}));
