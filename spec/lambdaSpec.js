/* globals describe it beforeEach expect fail */

const lambda = require('../index');
const NodeRSA = require('node-rsa');

const noop = () => {};

const deepCopy = (obj) => JSON.parse(JSON.stringify(obj));

const merge = (a, b) => Object.assign({}, a, b);

const key = new NodeRSA({b: 512});
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
          url: 'http://foo.com/user/repo/pulls/2',
          issue_url: 'http://foo.com/user/repo/issues/2',
          user: {
            login: 'ColinEberhardt'
          },
          head: {
            sha: '1234'
          }
        },
        repository: {
          url: 'http://foo.com/user/repo'
        }
      }
    };

    // mock the typical requests that the lambda function makes
    mockConfig = {
      // the first step is to make a request for the download URL for the cla config
      'http://foo.com/user/repo/contents/.clabot': {
        body: {
          download_url: 'http://raw.foo.com/user/repo/contents/.clabot'
        }
      },
      // the next is to download the .clabot config file
      'http://raw.foo.com/user/repo/contents/.clabot': {
        body: {
          contributors: ['ColinEberhardt'],
          token: key.encrypt(userToken, 'base64')
        }
      },
      // the next is to download the commits for the PR
      'http://foo.com/user/repo/pulls/2/commits': {
        body: [
          { author: { login: 'ColinEberhardt' } }
        ]
      },
      // next we add the relevant status
      'http://foo.com/user/repo/statuses/1234': {},
      // and optionally add a comment
      'http://foo.com/user/repo/issues/2/comments': {},
      // or a label
      'http://foo.com/user/repo/issues/2/labels': {}
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

  describe('HTTP issues', () => {

    it('should propagate HTTP request errors', (done) => {
      // create a mal-formed URL
      event.body.repository.url = 'http:://foo.com/user/repo';
      lambda.handler(event, {}, (err) => {
        expect(err).toEqual('Error: Invalid URI "http:://foo.com/user/repo/contents/.clabot"');
        done();
      }, {key});
    });

    it('should handle HTTP status codes that are not OK (2xx)', (done) => {
      const request = mockRequest({
        response: {
          statusCode: 404
        }
      });
      lambda.handler(event, {},
        (err, result) => {
          expect(err).toEqual('Error: GitHub API request failed with status 404');
          done();
        }, {request, key});
    });
  });

  describe('authorization tokens', () => {

    const verifyToken = (urls, expectedToken) => {
      const mock = deepCopy(mockConfig);
      urls.forEach((url) => {
        mock[url].verifyRequest = (opts) => {
          expect(opts.headers.Authorization).toEqual('token ' + expectedToken);
        };
      });
      return mock;
    };

    it('should add the bot GitHub auth token for the initial requests', (done) => {
      process.env.GITHUB_ACCESS_TOKEN = 'bot-token';
      const request = mockMultiRequest(verifyToken([
        'http://foo.com/user/repo/contents/.clabot',
        'http://raw.foo.com/user/repo/contents/.clabot'
      ], 'bot-token'));
      lambda.handler(event, {}, done, {request, key});
    });

    it('should use the clients auth token for labelling and status', (done) => {
      const request = mockMultiRequest(verifyToken([
        'http://foo.com/user/repo/statuses/1234',
        'http://foo.com/user/repo/pulls/2/commits',
        'http://foo.com/user/repo/issues/2/comments',
        'http://foo.com/user/repo/issues/2/labels'
      ], userToken));
      lambda.handler(event, {}, done, {request, key});
    });
  });

  it('should label pull requests from users with a signed CLA', (done) => {
    const request = mockMultiRequest(merge(mockConfig, {
      'http://foo.com/user/repo/statuses/1234': {
        verifyRequest: (opts) => {
          expect(opts.body.state).toEqual('success');
          expect(opts.body.context).toEqual('verification/cla-signed');
        }
      },
      'http://foo.com/user/repo/issues/2/labels': {
        verifyRequest: (opts) => {
          expect(opts.body).toEqual(['cla-signed']);
        }
      },
      'http://foo.com/user/repo/pulls/2/commits': {
        body: [
          // two commits, both from contributors
          { author: { login: 'ColinEberhardt' } },
          { author: { login: 'ColinEberhardt' } }
        ]
      }
    }));
    lambda.handler(event, {},
      (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual('added label cla-signed to http://foo.com/user/repo/pulls/2');
        done();
      }, {request, key});
  });

  it('should comment on pull requests where a CLA has not been signed', (done) => {
    const request = mockMultiRequest(merge(mockConfig, {
      'http://foo.com/user/repo/statuses/1234': {
        verifyRequest: (opts) => {
          expect(opts.body.state).toEqual('failure');
          expect(opts.body.context).toEqual('verification/cla-signed');
        }
      },
      'http://foo.com/user/repo/issues/2/comments': {
        verifyRequest: (opts) => {
          expect(opts.body.body).toContain('Thank you for your pull request');
        }
      },
      'http://foo.com/user/repo/pulls/2/commits': {
        body: [
          // two commits, one from a user which is not a contributor
          { author: { login: 'foo' } },
          { author: { login: 'ColinEberhardt' } }
        ]
      }
    }));

    lambda.handler(event, {},
      (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual('CLA has not been signed by users [foo], added a comment to http://foo.com/user/repo/pulls/2');
        done();
      }, {request, key});
  });

  it('should report the names of all committers without CLA', (done) => {
    const request = mockMultiRequest(merge(mockConfig, {
      'http://foo.com/user/repo/statuses/1234': {},
      'http://foo.com/user/repo/issues/2/comments': {},
      'http://foo.com/user/repo/pulls/2/commits': {
        body: [
          // three commits, two from a user which is not a contributor
          { author: { login: 'foo' } },
          { author: { login: 'bob' } },
          { author: { login: 'ColinEberhardt' } }
        ]
      }
    }));

    lambda.handler(event, {},
      (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual('CLA has not been signed by users [foo, bob], added a comment to http://foo.com/user/repo/pulls/2');
        done();
      }, {request, key});
  });
});
