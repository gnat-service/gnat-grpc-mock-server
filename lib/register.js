const {Provider, Consumer} = require('./collector');

const parseInteractions = contract => {
    if (!contract) {
        throw TypeError(`Random \`contract\` is not supported yet, please assign manually.`);
    }
    const t = typeof contract;
    if (t === 'string') {
        if (/^{/.test(contract)) {
            return JSON.parse(contract);
        }
        return require(contract);
    }
    if (t === 'object') {
        return contract;
    }
    throw TypeError(`Expect \`contract\` to be object, file path, or json string, got ${t}`);
};

const register = async ({port, Collector, files, brokerUrl, contract, outputFile, assertOpts}) => {
    const gg = require('gnat-grpc');
    contract = parseInteractions(contract);
    const {provider, consumer, contracts: interactions} = contract;

    const bindPath = `localhost:${port}`;
    const options = {
        bindPath,
        services: files.map(filename => (
            {filename}
        )),
    };
    const server = await gg.Server.addServer(options);
    const client = await gg.Client.checkoutServices(options);
    const collector = new Collector({server, client, brokerUrl, outputFile, consumer, provider, assertOpts});
    await collector.initialize(contract);

    return collector;
};

/**
 *
 * @param {!object} opts
 * @param {!number} opts.port
 * @param {!string[]} opts.files
 * @param {string} opts.brokerUrl
 * @param {object} opts.contract
 * @param {object} opts.assertOpts
 */
const provider = async (opts) => {
    if (opts.brokerUrl) {
        opts.contract = await Provider.getContractFromBroker(opts);
    }
    return register(Object.assign(opts || {}, {Collector: Provider}));
};

/**
 *
 * @param {!object} opts
 * @param {!number} opts.port
 * @param {!string[]} opts.files
 * @param {string} opts.brokerUrl
 * @param {!object} opts.contract
 * @param {string} opts.outputFile
 */
const consumer = async (opts) =>
    register(Object.assign(opts || {}, {Collector: Consumer}));

module.exports = {
    provider,
    consumer
};
