const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const lambda = require('../index');

const event = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'event.json')));

lambda.handler(event, {}, (err, message) => {
  if (err) {
    console.error(err, message);
  } else {
    console.log(message);
  }
});
