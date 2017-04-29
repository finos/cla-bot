/* globals describe it beforeEach expect fail */

const lambda = require('../index');
const ursa = require('ursa');
const fs = require('fs');

const noop = () => {};

const merge = (a, b) => Object.assign({}, a, b);

const crt = ursa.createPublicKey(fs.readFileSync('clabotkey.pub'));
const userToken = 'this-is-a-test';

// mocks the request package to return the given response (error, response, body)
// when invoked. A verifyRequest callback can be supplied in order to intercept / verify
// request options
const mockRequest = ({error, response, body, verifyRequest = noop}) =>
  (opts, cb) => {
    console.log('Mocking response for ' + opts.url);
    verifyRequest(opts, cb);
    cb(error, response, body);
  };

// mock multiple requests, mapped by URL
const mockMultiRequest = (config) =>
  (opts, cb) => {
    if (config[opts.url]) {
      return mockRequest(config[opts.url])(opts, cb);
    } else {
      fail(`No mock found for request ${opts.url}`);
    }
  };

describe('lambda function', () => {

  let event = {};
  let mockConfig = {};

  beforeEach(() => {
    // a standard event input for the lambda
    event = {
      body: {
        action: 'opened',
        pull_request: {
          issue_url: 'http://foo.com/bar',
          user: {
            login: 'ColinEberhardt'
          },
          head: {
            sha: '1234'
          }
        },
        repository: {
          url: 'http://foo.com/bar'
        }
      }
    };

    // mock the typical requests that the lambda function makes
    mockConfig = {
      // the first step is to make a request for the download URL for the cla config
      'http://foo.com/bar/contents/.clabot': {
        body: {
          download_url: 'http://raw.foo.com/bar/contents/.clabot'
        }
      },
      // the next is to download the .clabot config file
      'http://raw.foo.com/bar/contents/.clabot': {
        body: {
          contributors: ['ColinEberhardt'],
          token: crt.encrypt(userToken, 'utf8', 'base64')
        }
      }
    };
  });

  // TODO: Test X-GitHub-Event header is a pull_request type

  it('should ignore actions that are not pull requests being opened', (done) => {
    event.body.action = 'label';
    lambda.handler(event, {}, (err, result) => {
      expect(err).toBeNull();
      expect(result.message).toEqual('ignored action of type label');
      done();
    });
  });

  it('should propagate HTTP request errors', (done) => {
    // create a mal-formed URL
    event.body.repository.url = 'http:://foo.com/bar';
    lambda.handler(event, {}, (err) => {
      expect(err).toEqual('Error: Invalid URI "http:://foo.com/bar/contents/.clabot"');
      done();
    });
  });

  it('should handle HTTP status codes that are not OK (2xx)', (done) => {
    lambda.handler(event, {},
      (err, result) => {
        expect(err).toEqual('Error: GitHub API request failed with status 404');
        done();
      },
      mockRequest({
        response: {
          statusCode: 404
        }
      }));
  });

  it('should add GitHub auth token to the request', (done) => {
    process.env.GITHUB_ACCESS_TOKEN = 'test-token';
    lambda.handler(event, {}, done,
      mockRequest({
        verifyRequest: (opts) =>
          expect(opts.headers.Authorization).toEqual('token test-token')
      }));
  });

  it('should use the clients auth token for labelling', (done) => {
    const mock = mockMultiRequest(merge(mockConfig, {
      'http://foo.com/bar/statuses/1234': {},
      'http://foo.com/bar/labels': {
        verifyRequest: (opts) => {
          expect(opts.headers.Authorization).toEqual('token ' + userToken);
        }
      }
    }));
    lambda.handler(event, {}, done, mock);
  });

  it('should label pull requests from users with a signed CLA', (done) => {
    const mock = mockMultiRequest(merge(mockConfig, {
      'http://foo.com/bar/statuses/1234': {
        verifyRequest: (opts) => {
          expect(opts.body.state).toEqual('success');
          expect(opts.body.context).toEqual('verification/cla-signed');
        }
      },
      'http://foo.com/bar/labels': {
        verifyRequest: (opts) => {
          expect(opts.url).toEqual('http://foo.com/bar/labels');
          expect(opts.body).toEqual(['cla-signed']);
        }
      }
    }));
    lambda.handler(event, {},
      (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual('added label cla-signed to http://foo.com/bar');
        done();
      }, mock);
  });

  it('should comment on pull requests where a CLA has not been signed', (done) => {
    // a user that isn't a contributor
    event.body.pull_request.user.login = 'foo';

    const mock = mockMultiRequest(merge(mockConfig, {
      'http://foo.com/bar/statuses/1234': {
        verifyRequest: (opts) => {
          expect(opts.body.state).toEqual('failure');
          expect(opts.body.context).toEqual('verification/cla-signed');
        }
      },
      // this is enough to verify that the URL was invoked!
      'http://foo.com/bar/comments': {}
    }));

    lambda.handler(event, {},
      (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual('CLA has not been signed by foo, added a comment to http://foo.com/bar');
        done();
      }, mock);
  });
});
