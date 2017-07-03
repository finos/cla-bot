const request = require('request');

module.exports = options => new Promise((resolve, reject) => {
  console.info('DEBUG', `API Request ${options.url}`, options);
  request(options, (error, response, body) => {
    if (error) {
      console.info('DEBUG', `API Response ${options.url}`, { error });
      reject(error.toString());
    } else if (response && response.statusCode && !response.statusCode.toString().startsWith('2')) {
      console.info('DEBUG', `API Response ${options.url}`, { statusCode: response.statusCode });
      reject(new Error(`API request ${options.url} failed with status ${response.statusCode}`));
    } else {
      console.info('DEBUG', `API Response ${options.url}`, body);
      resolve(body);
    }
  });
});
