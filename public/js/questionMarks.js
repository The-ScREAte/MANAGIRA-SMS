// Saving questions whose marks don't add up to the test's "out of" (server: utils/questionMarks.js).
// QuestionMarks.post(url, payload) saves like fetch + json, but when the server says the totals
// differ, a small dialog asks first: set the test's out of to the questions' total, save as they
// are, or cancel. Resolves { cancelled: true } or { response, result }.
(function () {
  'use strict';
  if (window.QuestionMarks) return;

  function send(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (json) { return { response: response, result: json }; });
    });
  }

  // 'setOutOf' | 'anyway' | 'cancel'
  function decide(marks) {
    var flow = window.AssessmentFlow;
    var tail = '';
    var buttons = [{ label: 'Cancel', value: 'cancel' }];
    if (marks.over) {
      tail = marks.canSetOutOf ? 'Raise the out of to match, or lower the marks.' : 'Scores are already recorded, so the out of can’t change. Lower the marks to save.';
    } else {
      tail = marks.canSetOutOf ? 'Marks count as they are, they are not scaled.' : 'Scores are already recorded, so the out of stays.';
      buttons.push({ label: 'Save anyway', value: 'anyway' });
    }
    if (marks.canSetOutOf) buttons.push({ label: 'Set out of to ' + marks.total, value: 'setOutOf', primary: true });
    if (!flow || typeof flow.dialog !== 'function') return Promise.resolve('cancel');
    return flow.dialog({
      title: 'Questions add up to ' + marks.total + ', but the test is out of ' + marks.outOf + '.',
      text: tail,
      buttons: buttons,
      escapeValue: 'cancel',
    }).then(function (value) { return value || 'cancel'; });
  }

  function post(url, payload) {
    return send(url, Object.assign({}, payload, { marksCheck: 'ask' })).then(function (first) {
      var marks = first.result && first.result.marks;
      if (first.response.status !== 409 || !first.result || !first.result.marksDiffer || !marks) {
        return { response: first.response, result: first.result, cancelled: false };
      }
      return decide(marks).then(function (choice) {
        if (choice !== 'setOutOf' && choice !== 'anyway') return { cancelled: true };
        return send(url, Object.assign({}, payload, { marksCheck: choice })).then(function (second) {
          return { response: second.response, result: second.result, cancelled: false };
        });
      });
    });
  }

  window.QuestionMarks = { post: post };
})();
