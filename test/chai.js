'use strict';

const fs = require('fs');
const path = require('path');

const chai = require('chai');
const json = require('firebase-json');
const targaryen = require('targaryen/plugins/chai');

chai.use(targaryen);

exports.chai = chai;
exports.expect = chai.expect;
exports.targaryen = targaryen;
exports.getRules = function() {
  const rulePath = path.join(__dirname, '../database.rules.json');
  const rulesBody = fs.readFileSync(rulePath);

  return json.parse(rulesBody);
};
