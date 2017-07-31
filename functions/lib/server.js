'use strict';

const exphbs = require('express-handlebars');
const express = require('express');

const database = require('./database');

const app = express();
const launchURL = '/lti/launch';

app.engine('handlebars', exphbs({defaultLayout: 'main'}));
app.set('view engine', 'handlebars');

app.get(['/', '/lti/'], (req, res) => res.render('index'));
app.post('/lti/credentials', (req, res, next) => {
  database.newCredentials()
    .then(credentials => res.render(
      'credentials',
      Object.assign(credentials, {launchURL})
    ))
    .catch(next);
});

module.exports = app;
