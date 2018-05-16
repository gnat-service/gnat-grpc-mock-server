const _ = require('lodash');
const {Interaction} = require('./interaction');
const fs = require('fs');

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
        return await super.exec(
            filter,
            async interaction => interaction.exec(opts)
        );
    }
}

const collectorInitialized = Symbol('collectorInitialized');
class Collector extends Picker {
    constructor ({server, client, contract, consumer, provider}) {
        super({});
        this.server = server;
        this.client = client;
        this.contract = this.formatContract(contract);
        this.consumer = consumer;
        this.provider = provider;
        this[collectorInitialized] = false;
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
                execution.executions.push(...data.executions);
            });
        });

    }

    getSuite (service) {
        return this.map[service];
    }

    getInteraction (service, method) {
        return this.getSuite(service).getInteraction(method);
    }

    formatContract (contract) {
        const {getInitialRequest, getInitialReply} = Interaction;
        _.each(contract.contracts, interaction => {
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

    initialize () {
        if (this[collectorInitialized]) {
            return;
        }
        this[collectorInitialized] = true;

        const methodsMap = {};
        _.each(this.server.services, ({service}, servicePath) => {
            const serviceContract = this.contract.contracts[servicePath] ||{};
            const caller = this.client.getService(servicePath);

            const suite = new Suite(service, servicePath, serviceContract);
            methodsMap[servicePath] = suite.initialize(caller, this);
            this.map[servicePath] = suite;
        });

        this.server.loadMethodsTree(methodsMap);
        _.each(this.map, suite => suite.initInteractions());
        this.server.start();
    }

    getContractData (data) {
        return {
            consumer: this.consumer,
            provider: this.provider,
            contracts: data
        };
    }

    async exec (filterMap = {}, opts = {}) {
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
}

class Consumer extends Collector {
    constructor (opts) {
        super(opts);
        this.name = this.consumer;
        this.outputFile = opts.outputFile;
    }

    async _printFile (data) {
        if (!this.outputFile) {
            return;
        }

        const text = typeof data === 'string' ?
            data :
            JSON.stringify(data, null, 2);

        return new Promise((resolve, reject) => {
            fs.writeFile(this.outputFile, text, err => {
                err ? reject(err) : resolve();
            });
        });
    }

    setOutputFile (filePath) {
        this.outputFile = filePath;
    }

    async exec (filterMap = {}, opts = {}) {
        if (opts.outputFile) {
            this.setOutputFile(opts.outputFile);
        }
        const ret = await super.exec(filterMap, opts);
        await this._printFile(ret);
        return ret;
    }
}

class Provider extends Collector {
    constructor (opts) {
        super(opts);
        this.name = this.provider;
        this.assertOpts = opts.assertOpts;
    }

    async exec (filterMap = {}, opts = {}) {
        opts.assertOpts = Object.assign(opts.assertOpts || {}, this.assertOpts);
        return super.exec(filterMap, opts);
    }
}

exports.Consumer = Consumer;
exports.Provider = Provider;
