const AWS = require('aws-sdk');

const dynamodb = new AWS.DynamoDB.DocumentClient();

exports.handler = ({ query }, lambdaContext, callback) => {
  const loggingCallback = (error, message) => {
    console.info('callback', error, message);
    callback(error, message);
  };

  const params = {
    TableName: process.env.LOGGING_TABLE,
    KeyConditionExpression: 'correlationKey = :key',
    ExpressionAttributeValues: {
      ':key': query.correlationKey
    }
  };

  dynamodb.query(params, (err, data) => {
    data.Items = data.Items.filter(d => d.level !== 'DEBUG');
    if (err) {
      console.log(err, err.stack);
    } else {
      loggingCallback(null, data.Items);
    }
  });
};
