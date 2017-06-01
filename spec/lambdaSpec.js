/* globals describe it beforeEach afterEach expect fail xit */
const mock = require('mock-require');

const noop = () => {};

const deepCopy = (obj) => JSON.parse(JSON.stringify(obj));

const merge = (a, b) => Object.assign({}, a, b);

const installationToken = 'this-is-a-test';

process.env.INTEGRATION_KEY = 'spec/test-key.pem';
process.env.INTEGRATION_ID = 2208;
process.env.INTEGRATION_ENABLED = true;

// mocks the request package to return the given response (error, response, body)
// when invoked. A verifyRequest callback can be supplied in order to intercept / verify
// request options
const mockRequest = ({error, response, body, verifyRequest = noop}) =>
  (opts, cb) => {
    console.info('Mocking response for ' + opts.url);
    verifyRequest(opts, cb);
    cb(error, response, body);
  };

// mock multiple requests, mapped by URL
const mockMultiRequest = (config) =>
  (opts, cb) => {
    const url = opts.url +
      (opts.qs
        ? '?' + Object.keys(opts.qs).map(k => `${k}=${opts.qs[k]}`).join('=')
        : '');
    if (config[url]) {
      return mockRequest(config[url])(opts, cb);
    } else {
      console.error(`No mock found for request ${url}`);
      fail(`No mock found for request ${url}`);
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
        },
        installation: {
          id: 1000
        }
      }
    };

    // mock the typical requests that the lambda function makes
    mockConfig = {
      // the bot first checks for an org-level config file
      'https://foo.com/repos/user/clabot-config/contents/.clabot': {
        // it returns a 404, as a result a repo-local config file is used
        response: {
          statusCode: 404
        }
      },
      // next step is to make a request for the download URL for the cla config
      'http://foo.com/user/repo/contents/.clabot': {
        body: {
          download_url: 'http://raw.foo.com/user/repo/contents/.clabot'
        }
      },
      // the next is to download the .clabot config file
      'http://raw.foo.com/user/repo/contents/.clabot': {
        body: {
          contributors: ['ColinEberhardt']
        }
      },
      // next use the integration API to obtain an access token
      'https://api.github.com/installations/1000/access_tokens': {
        body: {
          token: installationToken
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

  afterEach(() => {
    mock.stop('request');
    delete require.cache[require.resolve('../index')];
    delete require.cache[require.resolve('../githubApi')];
    delete require.cache[require.resolve('../requestAsPromise')];
    delete require.cache[require.resolve('../contributionVerifier')];
    delete require.cache[require.resolve('../installationToken')];
  });

  // TODO: Test X-GitHub-Event header is a pull_request type

  it('should ignore actions that are not pull requests being opened', (done) => {
    event.body.action = 'label';
    const lambda = require('../index');
    lambda.handler(event, {}, (err, result) => {
      expect(err).toBeNull();
      expect(result.message).toEqual('ignored action of type label');
      done();
    });
  });

  describe('HTTP issues', () => {

    xit('should propagate HTTP request errors', (done) => {
      // create a mal-formed URL
      event.body.repository.url = 'http:://foo.com/user/repo';
      const lambda = require('../index');
      lambda.handler(event, {}, (err) => {
        expect(err).toEqual('Error: Invalid URI "http:://foo.com/user/repo/contents/.clabot"');
        done();
      });
    });

  });

  describe('clabot configuration resolution', () => {

    it('should resolve .clabot on project root, if clabot-config is not present at org-level', (done) => {
      const request = mockMultiRequest(merge(mockConfig, {
        'https://foo.com/repos/user/clabot-config/contents/.clabot': {
          body: {
            download_url: 'http://raw.foo.com/clabot-config/contents/.clabot'
          }
        },
        'http://raw.foo.com/clabot-config/contents/.clabot': {
          body: {
            contributors: ['ColinEberhardt']
          }
        }
      }));

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toBeNull();
          done();
        });
    });

    it('should use org-level configuration if present', (done) => {
      const request = mockMultiRequest(merge(mockConfig, {
        'https://foo.com/repos/user/clabot-config/contents/.clabot': {
          body: {
            download_url: 'http://raw.foo.com/clabot-config/contents/.clabot'
          }
        },
        'http://raw.foo.com/clabot-config/contents/.clabot': {
          body: {
            contributors: ['ColinEberhardt']
          }
        }
      }));

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toBeNull();
          done();
        });
    });

    it('should fail if no .clabot is provided', (done) => {
      const request = mockMultiRequest(merge(mockConfig, {
        'https://foo.com/repos/user/clabot-config/contents/.clabot': {
          response: {
            statusCode: 404
          }
        },
        'http://foo.com/user/repo/contents/.clabot': {
          response: {
            statusCode: 404
          }
        }
      }));

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toEqual('Error: API request http://foo.com/user/repo/contents/.clabot failed with status 404');
          done();
        });
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

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {}, done);
    });

    it('should use the clients auth token for labelling and status', (done) => {
      const request = mockMultiRequest(verifyToken([
        'http://foo.com/user/repo/statuses/1234',
        'http://foo.com/user/repo/pulls/2/commits',
        'http://foo.com/user/repo/issues/2/comments',
        'http://foo.com/user/repo/issues/2/labels'
      ], installationToken));

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {}, done);
    });
  });

  describe('pull requests opened', () => {
    it('should label and set status on pull requests from users with a signed CLA', (done) => {
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

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toBeNull();
          expect(result.message).toEqual('added label cla-signed to http://foo.com/user/repo/pulls/2');
          done();
        });
    });

    it('should comment and set status on pull requests where a CLA has not been signed', (done) => {
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

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toBeNull();
          expect(result.message).toEqual('CLA has not been signed by users [foo], added a comment to http://foo.com/user/repo/pulls/2');
          done();
        });
    });

    it('should report the names of all committers without CLA', (done) => {
      const request = mockMultiRequest(merge(mockConfig, {
        'http://foo.com/user/repo/pulls/2/commits': {
          body: [
            // three commits, two from a user which is not a contributor
            { author: { login: 'foo' } },
            { author: { login: 'bob' } },
            { author: { login: 'ColinEberhardt' } }
          ]
        }
      }));

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toBeNull();
          expect(result.message).toEqual('CLA has not been signed by users [foo, bob], added a comment to http://foo.com/user/repo/pulls/2');
          done();
        });
    });
  });

  describe('contributor check configuration', () => {
    it('should support fetching of contributor list from a Github API URL', (done) => {
      const request = mockMultiRequest(merge(mockConfig, {
        'http://raw.foo.com/user/repo/contents/.clabot': {
          body: {
            contributorListGithubUrl: 'https://api.github.com/repos/foo/bar/contents/.contributors'
          }
        },
        'https://api.github.com/repos/foo/bar/contents/.contributors': {
          body: {
            download_url: 'http://raw.github.com/repos/foo/bar/contents/.contributors'
          }
        },
        'http://raw.github.com/repos/foo/bar/contents/.contributors': {
          body: ['bob']
        },
        'http://foo.com/user/repo/pulls/2/commits': {
          body: [
            // three commits, two from a user which is not a contributor
            { author: { login: 'foo' } },
            { author: { login: 'bob' } },
            { author: { login: 'ColinEberhardt' } }
          ]
        }
      }));

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toBeNull();
          expect(result.message).toEqual('CLA has not been signed by users [foo, ColinEberhardt], added a comment to http://foo.com/user/repo/pulls/2');
          done();
        });
    });

    it('should support fetching of contributor list from a URL', (done) => {
      const request = mockMultiRequest(merge(mockConfig, {
        'http://raw.foo.com/user/repo/contents/.clabot': {
          body: {
            contributorListUrl: 'http://bar.com/contributors.txt'
          }
        },
        'http://bar.com/contributors.txt': {
          body: ['bob']
        },
        'http://foo.com/user/repo/pulls/2/commits': {
          body: [
            // three commits, two from a user which is not a contributor
            { author: { login: 'foo' } },
            { author: { login: 'bob' } },
            { author: { login: 'ColinEberhardt' } }
          ]
        }
      }));

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toBeNull();
          expect(result.message).toEqual('CLA has not been signed by users [foo, ColinEberhardt], added a comment to http://foo.com/user/repo/pulls/2');
          done();
        });
    });

    it('should support fetching of contributors via a webhook', (done) => {

      const request = mockMultiRequest(merge(mockConfig, {
        'http://raw.foo.com/user/repo/contents/.clabot': {
          body: {
            contributorWebhook: 'http://bar.com/contributor'
          }
        },
        'http://bar.com/contributor?checkContributor=foo': {
          body: {
            isContributor: false
          }
        },
        'http://bar.com/contributor?checkContributor=bob': {
          body: {
            isContributor: true
          }
        },
        'http://bar.com/contributor?checkContributor=ColinEberhardt': {
          body: {
            isContributor: false
          }
        },
        'http://foo.com/user/repo/pulls/2/commits': {
          body: [
            // three commits, two from a user which is not a contributor
            { author: { login: 'foo' } },
            { author: { login: 'bob' } },
            { author: { login: 'ColinEberhardt' } }
          ]
        }
      }));

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toBeNull();
          expect(result.message).toEqual('CLA has not been signed by users [foo, ColinEberhardt], added a comment to http://foo.com/user/repo/pulls/2');
          done();
        });
    });
  });

  describe('pull requests updated', () => {
    it('should label and add status check on pull requests and update stats for users with a signed CLA', (done) => {
      event.body.action = 'synchronize';
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

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toBeNull();
          expect(result.message).toEqual('added label cla-signed to http://foo.com/user/repo/pulls/2');
          done();
        });
    });

    it('should comment and remove label / status check on pull requests where a CLA has not been signed', (done) => {
      event.body.action = 'synchronize';
      const request = mockMultiRequest(merge(mockConfig, {
        'http://foo.com/user/repo/statuses/1234': {
          verifyRequest: (opts) => {
            expect(opts.body.state).toEqual('failure');
            expect(opts.body.context).toEqual('verification/cla-signed');
          }
        },
        'http://foo.com/user/repo/issues/2/labels': {
          verifyRequest: (opts) => {
            expect(opts.body).toEqual(['cla-signed']);
            expect(opts.method).toEqual('DELETE');
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

      mock('request', request);
      const lambda = require('../index');

      lambda.handler(event, {},
        (err, result) => {
          expect(err).toBeNull();
          expect(result.message).toEqual('CLA has not been signed by users [foo], added a comment to http://foo.com/user/repo/pulls/2');
          done();
        });
    });
  });
});
