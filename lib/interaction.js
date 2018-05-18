const _ = require('lodash');
const ggConfig = require('gnat-grpc/config');
const deepEql = require('deep-eql');

const getSubPath = (parent, sub) => parent ? `${parent}.${sub}` : sub;

class Interaction {
    constructor (service, methodName, call, plan, assertOpts) {
        this.service = service;
        this.methodName = methodName;
        this.caller = this.service[methodName];
        this.call = call;
        this.map = {};
        this.mapping = [];
        this.assertOpts = this.getAssertOpts(assertOpts);

        this.initPath();
        this.requestType = this.getRequestType();
        this.replyType = this.getReplyType();
        this.addExecutions(plan && plan.executions);

        this.reset();
    }

    static wrapAssertionErr ({actual, expected, path, url, missedKeyOn}) {
        const pad = (str, n = 1) => `${_.repeat(' ', 4 * n)}${str}`;
        const message = [
            `${url}: verify failed on field \`${path}\``,
            ...(missedKeyOn ? ['', pad(`This field is missed in ${missedKeyOn} data.`)] : []),
            '',
            pad('expect:'),
            pad(JSON.stringify(expected.val), 2),
            '',
            pad('actual:'),
            pad(JSON.stringify(actual.val), 2),
            ''
        ].join('\n');

        const e = new Error(message);
        e.name = 'AssertionError';
        return e;
    }

    onDiff (data) {
        if (this.assertOpts.defaultAssertionOn) {
            throw Interaction.wrapAssertionErr(data);
        }
    }

    _formatExpectation (expectation, actual, assertOpts, path = '') {
        if (deepEql(actual, expectation)) {
            return;
        }

        let {onDiff} = assertOpts;
        onDiff = onDiff || ((...args) => this.onDiff(...args));
        const et = typeof expectation;
        const at = typeof actual;

        const diffTrigger = opts => {
            return () =>
                onDiff(
                    _.assign({
                        path,
                        url: this.getUrl(),
                        expected: {
                            val: expectation,
                            type: et
                        },
                        actual: {
                            val: actual,
                            type: at
                        }
                    }, opts)
                )
        };

        const defDiff = diffTrigger();

        const {trimUncovered} = assertOpts;

        if (!expectation || !actual) {
            return defDiff();
        }

        if (at !== et) {
            return defDiff();
        }

        if (at !== 'object') {
            return defDiff();
        }

        if (expectation instanceof Date) {
            return defDiff();
        }

        const eIsArr = Array.isArray(expectation);
        const aIsArr = Array.isArray(actual);

        if (eIsArr !== aIsArr) {
            return defDiff();
        }
        if (eIsArr) {
            if (expectation.length !== actual.length) {
                return defDiff();
            }
            return expectation.forEach((e, i) => {
                if (deepEql(e, actual[i])) {
                    return;
                }
                this._formatExpectation(e, actual[i], assertOpts, `${path}[${i}]`);
            });
        }

        const aKeys = _.keys(actual);
        const eKeys = _.keys(expectation);
        const allKeys = _.union(aKeys, eKeys);

        allKeys.forEach(key => {
            const [e, a] = [expectation[key], actual[key]];
            const subPath = getSubPath(path, key);
            const opts = {
                path: subPath,
                expected: {
                    val: e,
                    type: et
                },
                actual: {
                    val: a,
                    type: at,
                }
            };

            if (!actual.hasOwnProperty(key)) {
                opts.missedKeyOn = 'actual';
                opts.actual.missedKey = true;
                return diffTrigger(opts)();
            }
            if (!expectation.hasOwnProperty(key)) {
                opts.missedKeyOn = 'expected';
                opts.expected.missedKey = true;
                // if `trimUncovered` is `true`, then delete this key from actual data, and return.
                return trimUncovered ?
                    (delete actual[key]) :
                    diffTrigger(opts)();
            }
            if (deepEql(e, a)) {
                return;
            }

            return this._formatExpectation(e, a, assertOpts, subPath);
        });
    }

    static createError (obj) {
        if (obj instanceof Error) {
            return obj;
        }

        let error;
        if (obj.details) {
            error = new Error(obj.details);
            obj = _.omit(obj, 'details');
        } else {
            error = new Error();
        }
        Object.assign(error, obj);
        return error;
    }

    getAssertOpts (assertOpts) {
        this.assertOpts = this.assertOpts || {};
        assertOpts = assertOpts || {};
        if (typeof assertOpts === 'function') {
            assertOpts = {fn: assertOpts};
        }
        return Object.assign(
            {trimUncovered: true},
            this.assertOpts,
            assertOpts
        );
    }

    getUrl () {
        return this.caller.path;
    }

    static getMetadata (obj) {
        const {Metadata} = ggConfig.grpc;
        if (obj instanceof Metadata) {
            return obj;
        }

        const metadata = new Metadata();
        obj && Object.keys(obj).forEach(k =>
            metadata.set(k, obj[k])
        );
        return metadata;
    }

    static getMetadataMap (metadata) {
        return Interaction.getMetadata(metadata).getMap();
    }

    static getInitialRequest (request = {}) {
        request.metadata = Interaction.getMetadataMap(request.metadata);
        request.callOptions = request.callOptions || {};
        return request;
    }

    static getInitialReply (reply = {}) {
        reply.reply = reply.reply || null;
        reply.error = reply.error || null;
        return reply;
    }

    getInitialRequest (request = {}, {format} = {}) {
        if (request.args && format) {
            request.args = this.formatArgs(request.args);
        }
        return Interaction.getInitialRequest(request);
    }

    getInitialReply (reply = {}, {format} = {}) {
        if (reply.reply && format) {
            reply.reply = this.formatReply(reply.reply);
        }
        return Interaction.getInitialReply(reply);
    }

    formatAssertion (assertion, {errorFields}) {
        if (!assertion) {
            return assertion;
        }
        assertion.request = this.getInitialRequest(assertion.request);
        assertion.reply = this.getInitialReply(assertion.reply);

        const {expectation} = assertion;
        if (!expectation) {
            return assertion;
        }

        expectation.request = this.getInitialRequest(expectation.request);
        expectation.reply = this.getInitialReply(expectation.reply);

        if (expectation.reply.error) {
            const {error} = assertion.reply;
            if (errorFields && errorFields.length) {
                assertion.reply.error = _.pick(error, errorFields);
                expectation.reply.error = _.pick(expectation.reply.error, errorFields);
            } else {
                errorFields = _.keys(error || {});
                if (errorFields.length) {
                    expectation.reply.error = _.pick(expectation.reply.error, errorFields);
                }
            }
        }
        return assertion;
    }

    addExecutions (executions) {
        if (!executions) {
            return;
        }

        if (!Array.isArray(executions)) {
            executions = [executions];
        }

        const {map} = this;
        const getKey = ({args}) => this._getSortedJsonId(args);
        const len = this.mapping.length;
        executions.forEach((execution, index) => {
            index += len;
            const request = this.getInitialRequest(_.clone(execution.request), {format: true});
            const key = getKey(request);
            if (map[key]) {
                throw new Error(`args: \`${key}\` already declared on ${this.getUrl()}`);
            }
            map[key] = {index, key, data: _.pick(execution, ['request', 'reply', 'expectation'])};
            this.mapping[index] = map[key];
            return map[key];
        });
        return this.mapping;
    }

    initPath () {
        [, this.servicePath, this.pkg, this.originMethodName] =
            this.caller.path.match(/\/((.+)\.([A-Z]\w+))\/\w+/) || [];
    }

    static getProxy () {
        return new Proxy({}, {
            get (target, key, receiver) {
                return Reflect.get(target, key, receiver);
            },
            set (target, key, value, receiver) {
                return Reflect.set(target, key, value, receiver);
            }
        });
    }

    reset () {
        this.results = this.mapping.map(() => Interaction.getProxy());
        this.mapping.forEach((o, i) => {
            const body = this.results[i];
            body.request = this.getInitialRequest();
            body.reply = this.getInitialReply();
            body.expectation = Interaction.getProxy();
            body.expectation.request = this.getInitialRequest();
            body.expectation.reply = this.getInitialReply();
        });
    }

    getRequestType () {
        return this.caller.requestType;
    }

    getReplyType () {
        return this.caller.responseType;
    }

    formatArgs (obj) {
        return this.caller.requestDeserialize(this.caller.requestSerialize(obj));
    }

    formatReply (obj) {
        return this.caller.responseDeserialize(this.caller.responseSerialize(obj));
    }

    _getSortedJsonId (obj) {
        if (obj instanceof Date) {
            return obj;
        }
        if (!obj) {
            return obj;
        }
        if (['number', 'string', 'boolean'].includes(typeof obj)) {
            return obj;
        }

        return JSON.stringify(this.formatArgs(obj));
    }

    getHandler () {
        const self = this;
        return function (args) {
            const key = self._getSortedJsonId(args);
            const {index, data: {reply/*, request, expectation*/}} = self.map[key];
            const body = self.results[index];
            body.expectation.request.args = args;
            if (reply.error) {
                throw Interaction.createError(reply.error);
            }
            return reply.reply;
        };
    }

    async _execOne ({data: {request, reply, expectation}}, index, opts) {
        opts = opts || {};
        let body = this.results[index];
        body.request = request;
        body.reply = reply;
        let err = null;
        let ret = null;
        try {
            ret = await this.call(request.args, request.metadata, request.callOptions);
        } catch (error) {
            err = error;
        }

        const assertOpts = this.getAssertOpts(opts.assertOpts);

        body.expectation.reply = {error: err, reply: ret};
        body = this.formatAssertion(body, assertOpts);

        const actual = JSON.parse(JSON.stringify(body.expectation));

        if (assertOpts.onDiff) {
            console.log()
        }
        this._formatExpectation(expectation, actual, assertOpts);

        if (typeof assertOpts.fn === 'function') {
            const [a, e] = [actual, expectation].map(e => _.pick(e, 'request', 'reply'));
            assertOpts.fn(a, e);
        }
    }

    async execOne (args, opts) {
        const key = this._getSortedJsonId(args);
        const record = this.map[key];
        if (!record) {
            throw new Error(`Interaction with args on ${this.getUrl()} \`${key}\` is not defined yet.`);
        }

        return this._execOne(record, record.index, opts);
    }

    async exec (opts) {
        this.reset();
        const promises = this.mapping.map((obj, index) => this._execOne(obj, index, opts));
        await Promise.all(promises);
        if (this.results) {
            return {executions: this.results};
        }
    }
}

exports.Interaction = Interaction;
