const _ = require('lodash');
const {Interaction} = require('./interaction');
const fs = require('fs');
const request = require('request');

const req = {};
['post', 'get'].forEach(method => {
    req[method] = function (data) {
        return new Promise((resolve, reject) =>
            request[method](data, function (err, res, body) {
                err = err || res.error;
                if (err) {
                    reject(err);
                } else {
                    if (typeof body === 'string') {
                        try {
                            body = JSON.parse(body);
                        } catch (e) {
                            const {stack} = e;
                            e = new Error(`parse \`body\` failed:\n${body}`);
                            e.stack = stack;
                            return reject(e);
                        }
                    }
                    if (!body.ok) {
                        const error = new Error(`Request "${data.url}" failed\n${body}`)
                        return reject(error);
                    }
                    resolve(body.data);
                }
            })
        );
    }
});

class Picker {
    constructor (map) {
        this.map = map;
    }

    pick (filter = {}) {
        if (typeof filter === 'string') {
            filter = [filter];
        }
        if (_.isArray(filter)) {
            filter = {include: filter};
        }
        let {include, exclude} = filter;
        if (include && include.length) {
            exclude = null;
        } else {
            include = null;
        }
        if (exclude && !exclude.length) {
            exclude = null;
        }

        if (!include && !exclude) {
            return _.clone(this.map);
        }

        if (!include && exclude && exclude.length) {
            return _.omit(this.map, exclude);
        }

        if (include && include.length) {
            return _.pick(this.map, include);
        }

        return _.clone(this.map);
    }

    async exec (filter, cb) {
        const picked = this.pick(filter);
        const results = {};
        await Promise.all(
            _.map(
                picked,
                async (v, k, ...args) => {
                    results[k] = await cb(v, k, ...args);
                }
            )
        );
        return results;
    }
}

class Suite extends Picker {
    constructor (service, servicePath, serviceContract) {
        super({});
        this.service = service;
        this.servicePath = servicePath;
        this.serviceContract = serviceContract || {};
    }

    addInteraction (methodName, interaction) {
        this.map[methodName].addExecutions(interaction.executions);
    }

    addInteractions (serviceContract) {
        serviceContract && _.each(serviceContract, (methodInteractions, methodName) => {
            this.addInteraction(methodName, methodInteractions);
        });
    }

    getInteraction (methodName) {
        return this.map[methodName];
    }

    initInteractions () {
        this.addInteractions(this.serviceContract);
    }

    initialize (caller, {assertOpts}) {
        const impls = {};
        const {service} = this;

        _.each(service, ({}, methodName) => {
            const interaction = new Interaction(
                service,
                methodName,
                (...args) => caller[methodName](...args),
                null,
                assertOpts,
            );

            this.map[methodName] = interaction;
            impls[methodName] = interaction.getHandler();
        });

        this.implements = impls;
        return impls;
    }

    async exec (filter, opts) {
        const ret = await super.exec(
            filter,
            async interaction => interaction.exec(opts)
        );

        if (ret) {
            return ret;
        }
    }
}

const COLLECTOR_NAME_REG = /^[a-zA-Z]\w+[a-zA-Z0-9]$/;
const getCollectorNameErrMsg = type =>
    `${type} name should be made up of letters, numbers and(or) "_", start with letters, and not end with "_"`;
const checkCollName = (type, name) => {
    if (!Collector._isFormattedName(name)) {
        throw new Error(getCollectorNameErrMsg(type));
    }
};

const collectorInitialized = Symbol('collectorInitialized');
class Collector extends Picker {
    constructor ({server, client, consumer, provider, brokerUrl}) {
        super({});
        this.server = server;
        this.client = client;
        this.brokerUrl = brokerUrl;
        this.dftFilterMap = {};
        this.contract = {contracts: {}};
        this.consumer = consumer;
        this.provider = provider;
        this[collectorInitialized] = false;
        checkCollName('Provider', this.provider);
        checkCollName('Consumer', this.consumer);
    }

    static buildContractUri (provider, consumer, tag) {
        const arr = [provider, consumer];
        tag && arr.push(tag);
        const patterns = arr.map(encodeURIComponent);
        return patterns.join('/');
    }

    static getFullContractUrl (brokerUrl, provider, consumer, tag) {
        if (!brokerUrl) {
            throw new TypeError('Expect `brokerUrl` to be not empty');
        }
        return [brokerUrl, 'contract', Collector.buildContractUri(provider, consumer, tag)].join('/');
    }

    static getAssertOpts (assertOpts) {
        assertOpts = assertOpts || {};
        if (typeof assertOpts === 'function') {
            assertOpts = {fn: assertOpts};
        }
        return Object.assign(
            {trimUncovered: true},
            assertOpts
        );
    }

    static _isFormattedName (name) {
        return COLLECTOR_NAME_REG.test(name);
    }

    buildContractUri () {
        return Collector.buildContractUrl(this.provider, this.consumer, this.tag);
    }

    getFullContractUrl (brokerUrl) {
        return Collector.getFullContractUrl(brokerUrl || this.brokerUrl, this.provider, this.consumer, this.tag);
    }

    addInteractions (extraContract) {
        extraContract = this.formatContract({contracts: extraContract}).contracts;
        _.each(extraContract, (contract, service) => {
            this.map[service].addInteractions(contract);
        });
        this._mergeInteractions(extraContract);
    }

    _mergeInteractions (formattedContract) {
        _.each(formattedContract, (interaction, service) => {
            this.contract.contracts[service] = this.contract.contracts[service] || {};
            const suite = this.contract.contracts[service];
            _.each(interaction, (data, methodName) => {
                suite[methodName] = suite[methodName] || {};
                const execution = suite[methodName];
                execution.executions = execution.executions || [];
                if (data.executions && data.executions.length) {
                    execution.executions.push(...data.executions);
                    this.addDftFilter(service, methodName);
                }
            });
        });
    }

    getSuite (service) {
        return this.map[service];
    }

    getInteraction (service, method) {
        return this.getSuite(service).getInteraction(method);
    }

    addDftFilter (service, method) {
        this.dftFilterMap[service] = this.dftFilterMap[service] || {include: []};
        const arr = this.dftFilterMap[service].include;
        !arr.includes(method) && arr.push(method);
    }

    formatContract (contract) {
        if (!contract) {
            return;
        }
        const {getInitialRequest, getInitialReply} = Interaction;
        _.each(contract.contracts, (interaction, service) => {
            _.each(interaction, (data, methodName) => {
                if (!data.executions) {
                    data = {executions: data};
                    interaction[methodName] = data;
                }
                if (!Array.isArray(data.executions)) {
                    data.executions = [data.executions];
                }

                data.executions.forEach(execution => {
                    execution.request = getInitialRequest(execution.request);
                    execution.reply = getInitialReply(execution.reply);
                    if (!execution.expectation) {
                        execution.expectation = null;
                        return;
                    }
                    execution.expectation.request = getInitialRequest(execution.expectation.request);
                    execution.expectation.reply = getInitialReply(execution.expectation.reply);
                });
            });
        });

        return contract;
    }

    initialize (contract) {
        if (this[collectorInitialized]) {
            return;
        }
        this[collectorInitialized] = true;

        contract = this.formatContract(contract);

        this.tag = contract.tag;
        if (contract.brokerUrl) {
            if (!Array.isArray(contract.brokerUrl)) {
                contract.brokerUrl = [contract.brokerUrl];
            }
            this.brokerUrl = contract.brokerUrl.map(url => url.replace(/\/$/, ''));
        }

        const methodsMap = {};
        _.each(this.server.services, ({service}, servicePath) => {
            const serviceContract = contract.contracts[servicePath] || {};
            const caller = this.client.getService(servicePath);

            const suite = new Suite(service, servicePath, serviceContract);
            methodsMap[servicePath] = suite.initialize(caller, this);
            this.map[servicePath] = suite;
        });

        this.server.loadMethodsTree(methodsMap);
        // _.each(this.map, suite => suite.initInteractions());
        this.addInteractions(contract.contracts);
        this.server.start();
    }

    getContractData (data) {
        return {
            consumer: this.consumer,
            provider: this.provider,
            brokerUrl: this.brokerUrl,
            contracts: data
        };
    }

    async exec (filterMap, opts = {}) {
        filterMap = _.isEmpty(filterMap) ? this.dftFilterMap : filterMap;
        if (typeof filterMap === 'string') {
            filterMap = [filterMap];
        }
        if (Array.isArray(filterMap)) {
            const m = {};
            filterMap.forEach(key => {
                m[key] = true;
            });
            filterMap = m;
        }
        const keys = _.keys(filterMap);
        const include = keys.filter(key => filterMap[key]);
        const exclude = keys.filter(key => !filterMap[key]);
        let result = await super.exec(
            {include, exclude},
            (suite, key) => suite.exec(filterMap[key], opts)
        );

        result = this.getContractData(result);

        return result;
    }

    async clearup () {
        await this.server.tryShutdown();
        this.client.close();
    }

    async execAndClearup (...args) {
        try {
            await this.exec(...args);
        } finally {
            await this.clearup().catch(() => {});
        }
    }
}

class Consumer extends Collector {
    constructor (opts) {
        super(opts);
        this.name = this.consumer;
        this.outputFile = opts.outputFile;
    }

    getContractData (data) {
        return Object.assign(
            super.getContractData(data),
            {assertOpts: this.providerAssertOpts}
        );
    }

    initialize (contract) {
        if (this[collectorInitialized]) {
            return;
        }
        if (contract.assertOpts) {
            this.providerAssertOpts = Collector.getAssertOpts(contract.assertOpts);
        }
        super.initialize(contract);
    }

    static getDataText (data, indents = 0) {
        return typeof data === 'string' ?
            data :
            JSON.stringify(data, null, indents);
    }

    async _printFile (data) {
        if (!this.outputFile) {
            return;
        }

        const text = Consumer.getDataText(data, 2);

        return new Promise((resolve, reject) => {
            fs.writeFile(this.outputFile, text, err => {
                err ? reject(err) : resolve();
            });
        });
    }

    async _publishContract (data) {
        if (!this.brokerUrl) {
            return;
        }

        const brokers = Array.isArray(this.brokerUrl) ? this.brokerUrl : [this.brokerUrl];

        return Promise.race(
            brokers.map(async broker => {
                if (!broker) {
                    return;
                }
                const url = this.getFullContractUrl(broker);
                const body = Consumer.getDataText(data);
                await req.post({url, headers: {'Content-Type': 'application/json'}, body});
            })
        );
    }

    setOutputFile (filePath) {
        this.outputFile = filePath;
    }

    async exec (filterMap, opts = {}) {
        if (opts.outputFile) {
            this.setOutputFile(opts.outputFile);
        }
        const ret = await super.exec(filterMap, opts);
        await Promise.all([
            this._printFile(ret),
            this._publishContract(ret)
        ]);
        return ret;
    }
}

class Provider extends Collector {
    constructor (opts) {
        super(opts);
        this.name = this.provider;
        this.assertOpts = opts.assertOpts;
    }

    getContractData (data) {
        return Object.assign(
            super.getContractData(data),
            {assertOpts: this.assertOpts}
        );
    }

    static async getContractFromBroker ({brokerUrl, provider, consumer, tag}) {
        const brokers = Array.isArray(brokerUrl) ? brokerUrl : [brokerUrl];
        let ret;
        return Promise.race(
            brokers.map(async broker => {
                if (!broker || ret) {
                    return;
                }

                const url = Collector.getFullContractUrl(broker, provider, consumer, tag);
                ret = req.get({url});
                return ret;
            })
        );
    }

    initialize (contract) {
        if (this[collectorInitialized]) {
            return;
        }
        if (contract.assertOpts) {
            this.assertOpts = Collector.getAssertOpts(contract.assertOpts);
        }
        super.initialize(contract);
    }

    async exec (filterMap, opts = {}) {
        opts.assertOpts = Object.assign(opts.assertOpts || {}, this.assertOpts);
        return super.exec(filterMap, opts);
    }
}

exports.Consumer = Consumer;
exports.Provider = Provider;
