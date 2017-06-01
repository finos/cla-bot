/* globals jasmine */
const SpecReporter = require('jasmine-spec-reporter').SpecReporter;

console.info = () => {};

jasmine.getEnv().clearReporters();
jasmine.getEnv().addReporter(new SpecReporter({
  spec: {
    displayPending: true
  },
  summary: {
    displayDuration: false
  }
}));
