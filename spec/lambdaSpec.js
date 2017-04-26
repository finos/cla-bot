/* globals describe it beforeEach expect */

const lambda = require('../index');

const noop = () => {};

// mocks the request package to return the given response (error, response, body)
// when invoked. A verifyRequest callback can be supplied in order to intercept / verifyR
// request options
const mockRequest = ({error, response, body, verifyRequest = noop}) =>
  (opts, cb) => {
    verifyRequest(opts, cb);
    cb(error, response, body);
  };

describe('lambda function', () => {

  let event = {};

  beforeEach(() => {
    event = {
      body: {
        action: 'opened',
        pull_request: {
          issue_url: 'http://foo.com/bar',
          user: {
            login: 'ColinEberhardt'
          }
        }
      }
    };
  });

  // TODO: Test X-GitHub-Event header is a pull_request type

  it('should ignore actions that are not pull requests being opened', (done) => {
    event.body.action = 'label';
    lambda.handler(event, {}, (_, result) => {
      expect(result.message).toEqual('ignored action of type label');
      done();
    });
  });

  it('should propagate HTTP request errors', (done) => {
    // create a mal-formed URL
    event.body.pull_request.issue_url = 'http:://foo.com/bar';
    lambda.handler(event, {}, (err) => {
      expect(err).toEqual('Error: Invalid URI "http:://foo.com/bar/labels"');
      done();
    });
  });

  it('should handle HTTP status codes that are not OK (200)', (done) => {
    lambda.handler(event, {},
      (_, result) => {
        expect(result.message).toEqual('GitHub API request failed');
        expect(result.body).toEqual('some error reported by GitHub');
        expect(result.statusCode).toEqual(404);
        done();
      },
      mockRequest({
        response: {
          statusCode: 404
        },
        body: 'some error reported by GitHub'
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

  it('should label pull requests from users with a signed CLA', (done) => {
    lambda.handler(event, {},
      (_, result) => {
        expect(result.message).toEqual('added label cla-signed to http://foo.com/bar');
        done();
      }, mockRequest({
        verifyRequest: (opts) => {
          expect(opts.url).toEqual('http://foo.com/bar/labels');
          expect(opts.body).toEqual(['cla-signed']);
        }
      }));
  });

  it('should comment on pull requests where a CLA has not been signed', (done) => {
    event.body.pull_request.user.login = 'foo';
    lambda.handler(event, {},
      (_, result) => {
        expect(result.message).toEqual('CLA has not been signed by foo, added a comment to http://foo.com/bar');
        done();
      }, mockRequest({
        verifyRequest: (opts) => {
          expect(opts.url).toEqual('http://foo.com/bar/comments');
          // TODO: verify message body
        }
      }));
  });
});
