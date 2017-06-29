const request = require('request');

module.exports = opts => new Promise((resolve, reject) => {
  console.info('API Request', opts.url, JSON.stringify(opts, null, 2));
  request(opts, (error, response, body) => {
    console.info('API Response', opts.url, error, response && response.statusCode, JSON.stringify(body, null, 2));
    if (error) {
      reject(error.toString());
    } else if (response && response.statusCode && !response.statusCode.toString().startsWith('2')) {
      reject(new Error(`API request ${opts.url} failed with status ${response.statusCode}`));
    } else {
      resolve(body);
    }
  });
});
