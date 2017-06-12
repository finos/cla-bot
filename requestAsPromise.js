const request = require('request');

module.exports = opts => new Promise((resolve, reject) => {
  console.info('API Request', opts.url, JSON.stringify(opts, null, 2));
  request(opts, (error, response, body) => {
    if (error) {
      reject(error.toString());
    } else if (response && response.statusCode && !response.statusCode.toString().startsWith('2')) {
      reject(new Error(`API request ${opts.url} failed with status ${response.statusCode}`));
    } else {
      console.info('API Response', opts.url, JSON.stringify(body, null, 2));
      resolve(body);
    }
  });
});
