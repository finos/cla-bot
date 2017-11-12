const AWS = require('aws-sdk');
const uuid = require('uuid/v4');

const dynamoClient = new AWS.DynamoDB.DocumentClient();

const removeEmptyStringElements = (obj) => {
  for (const prop in obj) {
    if (typeof obj[prop] === 'object') {
      removeEmptyStringElements(obj[prop]);
    } else if (obj[prop] === '') {
      delete obj[prop];
    }
  }
  return obj;
};

module.exports = (adaptee, correlationKey) => {
  // we use console.info because AWS logs this, however, we can suppress console.info
  // when running the unit tests to given a cleaner output
  const adapted = (level, message, detail) => {
    const logData = {
      time: new Date().toISOString(),
      uuid: uuid(),
      correlationKey,
      level,
      message,
      detail
    };

    adaptee(JSON.stringify(logData));

    if (!process.env.JASMINE) {
      dynamoClient.put({
        TableName: process.env.LOGGING_TABLE,
        Item: removeEmptyStringElements(logData)
      }, (err) => {
        if (err) {
          console.error('Unable to write to DynamoDb', err, logData);
        }
      });
    }
  };

  return adapted;
};
