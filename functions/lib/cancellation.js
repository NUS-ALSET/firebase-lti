'use strict';

const prex = require('prex');

exports.Error = prex.CancelError;
exports.Token = prex.CancellationToken;
exports.TokenSource = prex.CancellationTokenSource;

exports.TimedTokenSource = class TimedTokenSource extends prex.CancellationTokenSource {

  constructor(delay = 0, linkedTokens) {
    super(linkedTokens);
    this._timer = setTimeout(() => super.cancel(), delay);
  }

  cancel() {
    clearTimeout(this._timer);
    return super.cancel();
  }

  close() {
    clearTimeout(this._timer);
    return super.close();
  }

};
