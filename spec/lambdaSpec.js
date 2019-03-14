/* globals describe it beforeEach expect fail xit */
/* eslint global-require:0 */
/* eslint import/no-extraneous-dependencies:0 */
const mock = require("mock-require");

const noop = () => {};

const deepCopy = obj => JSON.parse(JSON.stringify(obj));

const merge = (a, b) => Object.assign({}, a, b);

const installationToken = "this-is-a-test";

process.env.INTEGRATION_KEY = "spec/test-key.pem";
process.env.INTEGRATION_ID = "2208";
process.env.INTEGRATION_ENABLED = "true";
process.env.BOT_NAME = "cla-bot";

// suppress logging, and sending of logs to S3, when unit testing
console.info = noop;
process.env.JASMINE = true;

// mocks the request package to return the given response (error, response, body)
// when invoked. A verifyRequest callback can be supplied in order to intercept / verify
// request options
const mockRequest = ({ error, response, body, verifyRequest = noop }) => (
  opts,
  cb
) => {
  verifyRequest(opts, cb);
  cb(error, response, body);
};

// mock multiple requests, mapped by URL
const mockMultiRequest = config => (opts, cb) => {
  const url =
    opts.url +
    (opts.qs
      ? "?" +
        Object.keys(opts.qs)
          .map(k => `${k}=${opts.qs[k]}`)
          .join("=") // eslint-disable-line
      : "");
  if (config[url]) {
    return mockRequest(config[url])(opts, cb);
  } else {
    console.error(`No mock found for request ${url}`);
    fail(`No mock found for request ${url}`);
    return {};
  }
};

describe("lambda function", () => {
  let event = {};
  let mockConfig = {};

  beforeEach(() => {
    // a standard event input for the lambda
    event = {
      body: {
        action: "opened",
        pull_request: {
          url: "http://foo.com/user/repo/pulls/2",
          issue_url: "http://foo.com/user/repo/issues/2",
          user: {
            login: "ColinEberhardt"
          },
          head: {
            sha: "1234"
          }
        },
        repository: {
          url: "http://foo.com/user/repo"
        },
        installation: {
          id: 1000
        }
      }
    };

    // mock the typical requests that the lambda function makes
    mockConfig = {
      // the bot first checks for an org-level config file
      "https://foo.com/repos/user/clabot-config/contents/.clabot": {
        // it returns a 404, as a result a repo-local config file is used
        response: {
          statusCode: 404
        }
      },
      // next step is to make a request for the download URL for the cla config
      "http://foo.com/user/repo/contents/.clabot": {
        body: {
          download_url: "http://raw.foo.com/user/repo/contents/.clabot"
        }
      },
      // the next is to download the .clabot config file
      "http://raw.foo.com/user/repo/contents/.clabot": {
        body: {
          contributors: ["ColinEberhardt"]
        }
      },
      // next use the integration API to obtain an access token
      "https://api.github.com/installations/1000/access_tokens": {
        body: {
          token: installationToken
        }
      },
      // the next is to download the commits for the PR
      "http://foo.com/user/repo/pulls/2/commits": {
        body: [
          {
            sha: "1234",
            author: { login: "ColinEberhardt" }
          }
        ]
      },
      // next we add the relevant status
      "http://foo.com/user/repo/statuses/1234": {},
      // and optionally add a comment
      "http://foo.com/user/repo/issues/2/comments": {},
      // or a label
      "http://foo.com/user/repo/issues/2/labels": {
        body: []
      }
    };

    // remove the cached dependencies so that new mocks can be injected
    Object.keys(require.cache).forEach(key => {
      delete require.cache[key];
    });
  });

  // TODO: Test X-GitHub-Event header is a pull_request type

  // the code has been migrated to the serverless framework which
  // stringifies the event body, and expects a stringified response
  const adaptedLambda = lambda => (ev, context, callback) => {
    ev.body = JSON.stringify(event.body);
    lambda(ev, context, (err, result) => {
      callback(
        err,
        result && result.body ? JSON.parse(result.body) : undefined
      );
    });
  };

  it("should ignore actions that are not pull requests being opened", done => {
    event.body.action = "label";
    const lambda = require("../src/index");

    adaptedLambda(lambda.handler)(event, {}, (err, result) => {
      expect(err).toBeNull();
      expect(result.message).toEqual("ignored action of type label");
      done();
    });
  });

  it("should ignore actions that are issue creation", done => {
    event.body = {
      action: "created",
      issue: {
        url: "https://api.github.com/repos/getgauge/gauge/issues/823"
      }
    };
    const lambda = require("../src/index");
    adaptedLambda(lambda.handler)(event, {}, (err, result) => {
      expect(err).toBeNull();
      expect(result.message).toEqual("ignored action of type created");
      done();
    });
  });

  describe("HTTP issues", () => {
    xit("should propagate HTTP request errors", done => {
      // create a mal-formed URL
      event.body.repository.url = "http:://foo.com/user/repo";
      const lambda = require("../src/index");
      adaptedLambda(lambda.handler)(event, {}, err => {
        expect(err).toEqual(
          'Error: Invalid URI "http:://foo.com/user/repo/contents/.clabot"'
        );
        done();
      });
    });
  });

  describe("clabot configuration resolution", () => {
    it("should resolve .clabot on project root, if clabot-config is not present at org-level", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "https://foo.com/repos/user/clabot-config/contents/.clabot": {
            body: {
              download_url: "http://raw.foo.com/clabot-config/contents/.clabot"
            }
          },
          "http://raw.foo.com/clabot-config/contents/.clabot": {
            body: {
              contributors: ["ColinEberhardt"]
            }
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, err => {
        expect(err).toBeNull();
        done();
      });
    });

    it("should use org-level configuration if present", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "https://foo.com/repos/user/clabot-config/contents/.clabot": {
            body: {
              download_url: "http://raw.foo.com/clabot-config/contents/.clabot"
            }
          },
          "http://raw.foo.com/clabot-config/contents/.clabot": {
            body: {
              contributors: ["ColinEberhardt"]
            }
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, err => {
        expect(err).toBeNull();
        done();
      });
    });

    it("should fail if no .clabot is provided", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "https://foo.com/repos/user/clabot-config/contents/.clabot": {
            response: {
              statusCode: 404
            }
          },
          "http://foo.com/user/repo/contents/.clabot": {
            response: {
              statusCode: 404
            }
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, err => {
        expect(err).toEqual(
          "Error: API request http://foo.com/user/repo/contents/.clabot failed with status 404"
        );
        done();
      });
    });

    it("should detect a malformed clabot file", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://raw.foo.com/user/repo/contents/.clabot": {
            // return an invalid configuration
            body: "asdasd"
          },
          "http://foo.com/user/repo/statuses/1234": {
            verifyRequest: opts => {
              // ensure the status is reported as a failure
              expect(opts.body.state).toEqual("error");
            }
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, err => {
        expect(err).toEqual("Error: The .clabot file is not valid JSON");
        done();
      });
    });
  });

  describe("authorization tokens", () => {
    const verifyToken = (urls, expectedToken) => {
      const mock = deepCopy(mockConfig); // eslint-disable-line
      urls.forEach(url => {
        mock[url].verifyRequest = opts => {
          expect(opts.headers.Authorization).toEqual(`token ${expectedToken}`);
        };
      });
      return mock;
    };

    it("should use the clients auth token for the initial requests", done => {
      process.env.GITHUB_ACCESS_TOKEN = "bot-token";
      const request = mockMultiRequest(
        verifyToken(
          [
            "http://foo.com/user/repo/contents/.clabot",
            "http://raw.foo.com/user/repo/contents/.clabot"
          ],
          installationToken
        )
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, done);
    });

    it("should use the clients auth token for labelling and status", done => {
      const request = mockMultiRequest(
        verifyToken(
          [
            "http://foo.com/user/repo/statuses/1234",
            "http://foo.com/user/repo/pulls/2/commits",
            "http://foo.com/user/repo/issues/2/comments",
            "http://foo.com/user/repo/issues/2/labels"
          ],
          installationToken
        )
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, done);
    });
  });

  describe("pull requests opened", () => {
    it("should label and set status on pull requests from users with a signed CLA", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://foo.com/user/repo/statuses/1234": {
            verifyRequest: opts => {
              expect(opts.body.state).toEqual("success");
              expect(opts.body.context).toEqual("verification/cla-signed");
            }
          },
          "http://foo.com/user/repo/issues/2/labels": {
            verifyRequest: opts => {
              if (opts.method === "POST") {
                expect(opts.body).toEqual(["cla-signed"]);
              }
            },
            body: []
          },
          "http://foo.com/user/repo/pulls/2/commits": {
            body: [
              // two commits, both from contributors
              { author: { login: "ColinEberhardt" } },
              { author: { login: "ColinEberhardt" } }
            ]
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual(
          "added label cla-signed to http://foo.com/user/repo/pulls/2"
        );
        done();
      });
    });

    it("should not set a label is it is already present", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://foo.com/user/repo/statuses/1234": {
            verifyRequest: opts => {
              expect(opts.body.state).toEqual("success");
              expect(opts.body.context).toEqual("verification/cla-signed");
            }
          },
          "http://foo.com/user/repo/issues/2/labels": {
            verifyRequest: opts => {
              if (opts.method === "POST") {
                fail("A label already exists, so should not be set");
              }
            },
            body: [{ name: "cla-signed" }]
          },
          "http://foo.com/user/repo/pulls/2/commits": {
            body: [{ author: { login: "ColinEberhardt" } }]
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual(
          "added label cla-signed to http://foo.com/user/repo/pulls/2"
        );
        done();
      });
    });

    it("should comment and set status on pull requests where a CLA has not been signed", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://foo.com/user/repo/statuses/1234": {
            verifyRequest: opts => {
              expect(opts.body.state).toEqual("error");
              expect(opts.body.context).toEqual("verification/cla-signed");
            }
          },
          "http://foo.com/user/repo/issues/2/comments": {
            verifyRequest: opts => {
              expect(opts.body.body).toContain(
                "Thank you for your pull request"
              );
            }
          },
          "http://foo.com/user/repo/pulls/2/commits": {
            body: [
              // two commits, one from a user which is not a contributor
              { author: { login: "foo" } },
              { author: { login: "ColinEberhardt" } }
            ]
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual(
          "CLA has not been signed by users @foo, added a comment to http://foo.com/user/repo/pulls/2"
        );
        done();
      });
    });

    it("should report the names of all committers without CLA", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://foo.com/user/repo/pulls/2/commits": {
            body: [
              // three commits, two from a user which is not a contributor
              { author: { login: "foo" } },
              { author: { login: "bob" } },
              { author: { login: "ColinEberhardt" } }
            ]
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual(
          "CLA has not been signed by users @foo, @bob, added a comment to http://foo.com/user/repo/pulls/2"
        );
        done();
      });
    });

    it("should not report duplicate names", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://foo.com/user/repo/pulls/2/commits": {
            body: [
              // three commits, two from a user which is not a contributor
              { author: { login: "bob" } },
              { author: { login: "bob" } },
              { author: { login: "ColinEberhardt" } }
            ]
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual(
          "CLA has not been signed by users @bob, added a comment to http://foo.com/user/repo/pulls/2"
        );
        done();
      });
    });

    it("should allow configuration of the pull request comment to include non-cla signed contributors", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://foo.com/user/repo/pulls/2/commits": {
            body: [
              // three commits, two from a user which is not a contributor
              { author: { login: "foo" } },
              { author: { login: "bob" } },
              { author: { login: "ColinEberhardt" } }
            ]
          },
          "http://raw.foo.com/user/repo/contents/.clabot": {
            body: {
              contributors: ["ColinEberhardt"],
              message:
                "These are the naught ones {{usersWithoutCLA}} report them!"
            }
          },
          "http://foo.com/user/repo/issues/2/comments": {
            verifyRequest: opts => {
              expect(opts.body.body).toContain(
                "These are the naught ones @foo, @bob report them!"
              );
            }
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, err => {
        expect(err).toBeNull();
        done();
      });
    });
  });

  describe("bot summoned to re-check", () => {
    it("should ignore comments from the bot", done => {
      // comments have a slightly different payload.
      event = {
        body: {
          action: "created",
          issue: {
            url: "http://foo.com/user/repo/issues/2",
            pull_request: {
              url: "http://foo.com/user/repo/pulls/2"
            }
          },
          comment: {
            user: {
              login: "cla-bot[bot]"
            },
            body: "@cla-bot check"
          },
          repository: {
            url: "http://foo.com/user/repo"
          },
          installation: {
            id: 1000
          }
        }
      };

      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual("the cla-bot summoned itself. Ignored!");
        done();
      });
    });

    it("should add a comment to indicate it was successfully summoned", done => {
      // comments have a slightly different payload.
      event = {
        body: {
          action: "created",
          issue: {
            url: "http://foo.com/user/repo/issues/2",
            pull_request: {
              url: "http://foo.com/user/repo/pulls/2"
            }
          },
          comment: {
            user: {
              login: "fish"
            },
            body: "@cla-bot check"
          },
          repository: {
            url: "http://foo.com/user/repo"
          },
          installation: {
            id: 1000
          }
        }
      };

      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://foo.com/user/repo/issues/2/comments": {
            verifyRequest: opts => {
              expect(opts.body.body).toContain(
                "The cla-bot has been summoned, and re-checked this pull request!"
              );
            }
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual(
          "added label cla-signed to http://foo.com/user/repo/pulls/2"
        );
        done();
      });
    });
  });

  describe("pull requests updated", () => {
    it("should label and add status check on pull requests and update stats for users with a signed CLA", done => {
      event.body.action = "synchronize";
      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://foo.com/user/repo/statuses/1234": {
            verifyRequest: opts => {
              expect(opts.body.state).toEqual("success");
              expect(opts.body.context).toEqual("verification/cla-signed");
            }
          },
          "http://foo.com/user/repo/issues/2/labels": {
            verifyRequest: opts => {
              if (opts.method === "POST") {
                expect(opts.body).toEqual(["cla-signed"]);
              }
            },
            body: []
          },
          "http://foo.com/user/repo/pulls/2/commits": {
            body: [
              // two commits, both from contributors
              { author: { login: "ColinEberhardt" } },
              { author: { login: "ColinEberhardt" } }
            ]
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual(
          "added label cla-signed to http://foo.com/user/repo/pulls/2"
        );
        done();
      });
    });

    it("should comment and remove label / status check on pull requests where a CLA has not been signed", done => {
      event.body.action = "synchronize";
      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://foo.com/user/repo/statuses/1234": {
            verifyRequest: opts => {
              expect(opts.body.state).toEqual("error");
              expect(opts.body.context).toEqual("verification/cla-signed");
            }
          },
          "http://foo.com/user/repo/issues/2/labels": {
            verifyRequest: opts => {
              if (opts.method !== "GET") {
                expect(opts.body).toEqual(["cla-signed"]);
                expect(opts.method).toEqual("DELETE");
              }
            },
            body: []
          },
          "http://foo.com/user/repo/issues/2/comments": {
            verifyRequest: opts => {
              expect(opts.body.body).toContain(
                "Thank you for your pull request"
              );
            }
          },
          "http://foo.com/user/repo/pulls/2/commits": {
            body: [
              // two commits, one from a user which is not a contributor
              { author: { login: "foo" } },
              { author: { login: "ColinEberhardt" } }
            ]
          }
        })
      );

      mock("request", request);
      const lambda = require("../src/index");

      adaptedLambda(lambda.handler)(event, {}, (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual(
          "CLA has not been signed by users @foo, added a comment to http://foo.com/user/repo/pulls/2"
        );
        done();
      });
    });
  });

  describe("check unidentified contributors", () => {
    it("should fail if user is not set", done => {
      const request = mockMultiRequest(
        merge(mockConfig, {
          "http://foo.com/user/repo/statuses/1234": {
            verifyRequest: opts => {
              expect(opts.body.state).toEqual("error");
            }
          },
          "http://foo.com/user/repo/issues/2/comments": {
            verifyRequest: opts => {
              expect(opts.body.body).toContain("Colin Eberhardt");
            }
          },
          // the next is to download the commits for the PR
          "http://foo.com/user/repo/pulls/2/commits": {
            body: [
              {
                sha: "1234",
                commit: {
                  author: {
                    name: "Colin Eberhardt"
                  }
                }
                // removed the author element, to reproduce the issue
              }
            ]
          }
        })
      );
      mock("request", request);
      const lambda = require("../src/index");
      adaptedLambda(lambda.handler)(event, {}, (err, result) => {
        expect(err).toBeNull();
        expect(result.message).toEqual(
          "CLA has not been signed by users Colin Eberhardt, added a comment to http://foo.com/user/repo/pulls/2"
        );
        done();
      });
    });
  });
});

describe("contributionVerifier", () => {
  beforeEach(() => {
    // remove the cached dependencies so that new mocks can be injected
    Object.keys(require.cache).forEach(key => {
      delete require.cache[key];
    });
  });

  describe("legacy configuration", () => {
    it("should support fetching of contributor list from a Github API URL", done => {
      const config = {
        contributorListGithubUrl:
          "https://api.github.com/repos/foo/bar/contents/.contributors"
      };

      const request = mockMultiRequest({
        "https://api.github.com/repos/foo/bar/contents/.contributors": {
          body: {
            download_url:
              "http://raw.github.com/repos/foo/bar/contents/.contributors"
          }
        },
        "http://raw.github.com/repos/foo/bar/contents/.contributors": {
          body: ["Bob", "frank"]
        }
      });

      mock("request", request);
      const verifier = require("../src/contributionVerifier");

      verifier(config)(["bob"]).then(nonContributors => {
        expect(nonContributors).toEqual([]);
        done();
      });
    });

    it("should support fetching of contributor list from a URL", done => {
      const config = {
        contributorListUrl: "http://bar.com/contributors.txt"
      };

      const request = mockMultiRequest({
        "http://bar.com/contributors.txt": {
          body: ["bob"]
        }
      });

      mock("request", request);
      const verifier = require("../src/contributionVerifier");

      verifier(config)(["bob", "billy"]).then(nonContributors => {
        expect(nonContributors).toEqual(["billy"]);
        done();
      });
    });

    it("should support contributor verification via webhook", done => {
      const config = {
        contributorWebhook: "http://bar.com/contributor?checkContributor="
      };

      const request = mockMultiRequest({
        "http://bar.com/contributor?checkContributor=foo": {
          body: {
            isContributor: false
          }
        },
        "http://bar.com/contributor?checkContributor=bob": {
          body: {
            isContributor: true
          }
        }
      });

      mock("request", request);
      const verifier = require("../src/contributionVerifier");

      verifier(config)(["bob", "foo"]).then(nonContributors => {
        expect(nonContributors).toEqual(["foo"]);
        done();
      });
    });
  });

  describe("non legacy functionality", () => {
    it("should support an embedded contributor list", done => {
      const config = {
        contributors: ["billy"]
      };

      const verifier = require("../src/contributionVerifier");

      verifier(config)(["bob", "billy"]).then(nonContributors => {
        expect(nonContributors).toEqual(["bob"]);
        done();
      });
    });

    it("should support detection of a contributor list from a URL", done => {
      const config = {
        contributors: "http://bar.com/contributors.txt"
      };

      const request = mockMultiRequest({
        "http://bar.com/contributors.txt": {
          body: ["bob"]
        }
      });

      mock("request", request);
      const verifier = require("../src/contributionVerifier");

      verifier(config)(["bob", "billy"]).then(nonContributors => {
        expect(nonContributors).toEqual(["billy"]);
        done();
      });
    });

    it("should support detection of a contributor list that is a GitHUb URL", done => {
      const config = {
        contributors:
          "https://api.github.com/repos/foo/bar/contents/.contributors"
      };

      const request = mockMultiRequest({
        "https://api.github.com/repos/foo/bar/contents/.contributors": {
          body: {
            download_url:
              "http://raw.github.com/repos/foo/bar/contents/.contributors"
          }
        },
        "http://raw.github.com/repos/foo/bar/contents/.contributors": {
          body: ["bob", "frank"]
        }
      });

      mock("request", request);
      const verifier = require("../src/contributionVerifier");

      verifier(config)(["bob"]).then(nonContributors => {
        expect(nonContributors).toEqual([]);
        done();
      });
    });

    it("should support detection of contributor verification via webhook", done => {
      const config = {
        contributors: "http://bar.com/contributor?checkContributor="
      };

      const request = mockMultiRequest({
        "http://bar.com/contributor?checkContributor=foo": {
          body: {
            isContributor: false
          }
        },
        "http://bar.com/contributor?checkContributor=bob": {
          body: {
            isContributor: true
          }
        }
      });

      mock("request", request);
      const verifier = require("../src/contributionVerifier");

      verifier(config)(["bob", "foo"]).then(nonContributors => {
        expect(nonContributors).toEqual(["foo"]);
        done();
      });
    });

    it("should throw an error if no configuration is supplied", () => {
      const config = {};
      const verifier = require("../src/contributionVerifier");
      expect(() => verifier(config)).toThrow(
        new Error(
          "A mechanism for verifying contributors has not been specified"
        )
      );
    });

    it("should throw an error if the configuration is invalid", () => {
      const config = {
        contributors: "sausage"
      };
      const verifier = require("../src/contributionVerifier");
      expect(() => verifier(config)).toThrow(
        new Error(
          "A mechanism for verifying contributors has not been specified"
        )
      );
    });
  });
});

describe("lambda internals", () => {
  const internals = require("../src/index").test;

  describe("commentSummonsBot", () => {
    it("should match comments with one space", () => {
      expect(
        internals.commentSummonsBot("asdasd @cla-bot[bot] check dasd")
      ).toBe(true);
    });
    it("should match comments without the bot suffix space", () => {
      expect(internals.commentSummonsBot("asdasd @cla-bot check dasd")).toBe(
        true
      );
    });
    it("should match comments with multiple spaces", () => {
      expect(internals.commentSummonsBot("@cla-bot[bot]    check")).toBe(true);
    });
    it("should not match comments without the correct text", () => {
      expect(internals.commentSummonsBot("@cla-bot[bot]    chek")).toBe(false);
    });
  });
});
