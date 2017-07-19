const AWS = require('aws-sdk');

const cloudwatchlogs = new AWS.CloudWatchLogs();
const millisPerDay = 24 * 60 * 60 * 1000;
const now = new Date().getTime();

const parseLog = log =>
  JSON.parse(log.message.split('\t')[2].replace(/\n/g, ''));

exports.handler = ({ query }, lambdaContext, callback) => {
  const loggingCallback = (error, message) => {
    console.info('callback', error, message);
    callback(error, message);
  };

  const defaultParams = {
    logGroupName: process.env.LOG_GROUP_NAME,
    filterPattern: query.correlationKey.split('-')[0],
    startTime: now - (millisPerDay * 15),
    endTime: now + (millisPerDay * 15)
  };

  const fetchLogs = (params, cb) => {
    cloudwatchlogs.filterLogEvents(params, (err, data) => {
      console.log('request', JSON.stringify(params, null, 2));
      if (err) {
        console.error(err, err.stack);
        loggingCallback(err);
        return;
      }

      const events = data.events;

      if (data.nextToken) {
        fetchLogs(Object.assign({}, params, { nextToken: data.nextToken }), (res) => {
          cb(events.concat(res));
        });
      } else {
        cb(events);
      }
    });
  };

  fetchLogs(defaultParams, res => loggingCallback(null, res.map(parseLog)));
};
