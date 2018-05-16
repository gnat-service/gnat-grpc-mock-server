/**
 * Created by leaf4monkey on 05/10/2018
 */
const {consumer, provider} = require('../lib/register');
const {assert} = require('chai');
const PATH = require('path');
let contract = require('./interactions');
const {Consumer} = require('../lib/collector');
const _ = require('lodash');
const fs = require('fs');
const gg = require('gnat-grpc');
const grpc = require('grpc');
const protobufjs = require('protobufjs');
const expectedJson = require('./expected-contract.json');

const {contracts: expectedContracts} = expectedJson;

gg.config({
    root: PATH.join(__dirname, './.proto'),
    grpc,
    protobufjs
});
const {contract: interactions} = contract;
const getServerOpts = opts =>
    _.defaults(
        opts || {},
        {
            port: 50031,
            files: [
                'helloworld.proto',
                'nest-message.proto',
            ],
            contract,
        }
    );

process.on('unhandledRejection', e => console.error(e.stack || e));

describe('register()', () => {
    let collector;
    afterEach(() => collector && collector.clearup());
    it('should get a Consumer instance', async () => {
        collector = await consumer(getServerOpts());
        assert.instanceOf(collector, Consumer);
    });

    describe('Collector', () => {
        describe('#exec()', () => {
            it('should return the collected data produced by interactions', async () => {
                collector = await consumer(getServerOpts());
                const data = await collector.exec();
                console.log(expectedContracts);
                const json = JSON.parse(JSON.stringify(data));

                assert.deepEqual(_.omit(json, 'contracts'), _.omit(expectedJson, 'contracts'));
                assert.typeOf(json.contracts, 'Object');

                _.each(json.contracts, (suite, service) => {
                    _.each(suite, (interaction, methodName) => {
                        assert.instanceOf(interaction.executions, Array);
                        const e = expectedContracts[service][methodName].executions;
                        console.log(e)
                        assert.includeDeepMembers(
                            expectedContracts[service][methodName].executions,
                            interaction.executions
                        )
                    });
                });
            });

            context('when `Collector.prototype.assertOpts()` is assigned', () => {
                let i;
                let outputFile = PATH.join(__dirname, 'contract.json');

                beforeEach(async () => {
                    // consumer create the contract file
                    collector = await consumer(getServerOpts());
                });

                beforeEach(async () => {
                    collector.addInteractions({
                        'helloworld.Greeter': {
                            sayHello: {
                                request: {
                                    args: {
                                        name: 'Danna',
                                        position: '122,322',
                                        date: new Date('2017-01-01'),
                                        dbVal: 3.1415926
                                    }
                                },
                                reply: {
                                    error: {
                                        code: 2000,
                                        details: 'user `Danna` not exists'
                                    }
                                }
                            }
                        }
                    });
                });

                beforeEach(async () => collector.exec({}, {outputFile}));

                beforeEach(async () => collector && collector.clearup());

                // provider verify contract.
                beforeEach(async () => {
                    i = 0;
                    collector = await provider(
                        getServerOpts(
                            {
                                port: 50032,
                                contract: outputFile,
                                assertOpts: {
                                    fn (assertion, expectation) {
                                        i++;
                                    },
                                    errorFields: ['code', 'details']
                                }
                            }
                        )
                    );
                });
                afterEach(() => fs.unlinkSync(outputFile));
                afterEach(() => collector.clearup());

                it('provider should satisfy the contract', async () => {
                    await collector.exec();
                    const expectedJson = require('./expected-contract.json');
                    const json = require(outputFile);
                    assert.deepEqual(json, expectedJson);
                    assert.equal(i, 6);
                });
            });
        });
    });
});
