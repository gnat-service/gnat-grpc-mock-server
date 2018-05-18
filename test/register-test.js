/**
 * Created by leaf4monkey on 05/10/2018
 */
const {consumer, provider} = require('../lib/register');
const chai = require('chai');
const PATH = require('path');
let contract = require('./interactions');
const {Consumer} = require('../lib/collector');
const _ = require('lodash');
const fs = require('fs');
const gg = require('gnat-grpc');
const grpc = require('grpc');
const protobufjs = require('protobufjs');
const chaiAsPromised = require('chai-as-promised');
const rawExpectedJson = require('./expected-contract.json');

chai.use(chaiAsPromised);
const {assert} = chai;
const getExpectedJson = () => _.cloneDeep(rawExpectedJson);
let {contracts: expectedContracts} = getExpectedJson();

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
    let expectedJson;
    let collector;
    beforeEach(() => {
        expectedJson = getExpectedJson();
        ({contracts: expectedContracts} = expectedJson);
    });
    afterEach(() => collector && collector.clearup());
    it('should get a Consumer instance', async () => {
        collector = await consumer(getServerOpts());
        assert.instanceOf(collector, Consumer);
    });

    describe('Collector', () => {
        describe('#exec()', () => {
            beforeEach(async () => {
                collector = await consumer(getServerOpts());
            });
            context('returns', () => {
                it('should return the collected data produced by interactions', async () => {
                    const data = await collector.exec();
                    const json = JSON.parse(JSON.stringify(data));

                    assert.deepEqual(_.omit(json, 'contracts'), _.omit(expectedJson, 'contracts'));
                    assert.typeOf(json.contracts, 'Object');

                    _.each(json.contracts, (suite, service) => {
                        _.each(suite, (interaction, methodName) => {
                            assert.instanceOf(interaction.executions, Array);
                            assert.includeDeepMembers(
                                expectedContracts[service][methodName].executions,
                                interaction.executions
                            )
                        });
                    });
                });
            });

            context('when `Collector.prototype.assertOpts()` is assigned', () => {
                let i;
                let providerColl;
                let outputFile = PATH.join(__dirname, 'contract.json');

                beforeEach(() => {
                    i = 0;
                });

                afterEach(async () => collector && collector.clearup());
                afterEach(() => providerColl && providerColl.clearup());
                afterEach(() => fs.unlinkSync(outputFile));

                context('on same version proto files', () => {
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

                    beforeEach(async () => collector.exec(null, {outputFile}));

                    // provider verify contract.
                    beforeEach(async () => {
                        i = 0;
                        providerColl = await provider(
                            getServerOpts(
                                {
                                    port: 50032,
                                    contract: outputFile,
                                    assertOpts: {
                                        trimUncovered: true,
                                        fn (assertion, expectation) {
                                            assert.deepEqual(
                                                JSON.parse(JSON.stringify(assertion)),
                                                expectation
                                            );
                                            i++;
                                        },
                                        // errorFields: ['code', 'details']
                                    }
                                }
                            )
                        );
                    });

                    it('provider should satisfy the contract', async () => {
                        await providerColl.exec();
                        const expectedJson = require('./expected-contract.json');
                        const json = require(outputFile);
                        assert.deepEqual(json, expectedJson);
                        assert.equal(i, 6);
                    });
                });

                context('on different proto files', () => {
                    context('provider proto file introduced breaking changes', () => {
                        beforeEach(async () => collector.exec(null, {outputFile}));
                        beforeEach(async () => {
                            i = 0;
                            providerColl = await provider(
                                getServerOpts(
                                    {
                                        port: 50032,
                                        contract: outputFile,
                                        files: [
                                            'helloworld.proto',
                                            'new-broken-nest-message.proto',
                                        ],
                                        assertOpts: {
                                            defaultAssertionOn: true
                                        }
                                    }
                                )
                            );
                        });

                        it('should reject and show the difference between the actual data and expectation', async () => {
                            return assert.isRejected(
                                providerColl.exec({'helloworld.nestmessage.NestMessage': 'changeData'}),
                                /\/helloworld\.nestmessage\.NestMessage\/ChangeData: verify failed on field `request\.args\.addressList`\s+This field is missed in actual data/
                            );
                        });
                    });

                    context('provider proto file introduced non-breaking changes', () => {
                        beforeEach(async () => collector.exec(null, {outputFile}));
                        context('ignore uncovered keys from provider', () => {
                            beforeEach(async () => {
                                i = 0;
                                providerColl = await provider(
                                    getServerOpts(
                                        {
                                            port: 50032,
                                            contract: outputFile,
                                            files: [
                                                'helloworld.proto',
                                                'new-nest-message.proto',
                                            ],
                                            assertOpts: {
                                                trimUncovered: true,
                                                defaultAssertionOn: true
                                            }
                                        }
                                    )
                                );
                            });

                            it('should success', async () => {
                                return providerColl.exec({'helloworld.nestmessage.NestMessage': 'changeData'});
                            });
                        });

                        context('ignore uncovered keys from provider', () => {
                            beforeEach(async () => {
                                i = 0;
                                providerColl = await provider(
                                    getServerOpts(
                                        {
                                            port: 50032,
                                            contract: outputFile,
                                            files: [
                                                'helloworld.proto',
                                                'new-nest-message.proto',
                                            ],
                                            assertOpts: {
                                                trimUncovered: false,
                                                defaultAssertionOn: true
                                            }
                                        }
                                    )
                                );
                            });

                            it('should reject and show the difference between the actual data and expectation', async () => {
                                return assert.isRejected(
                                    providerColl.exec({'helloworld.nestmessage.NestMessage': 'changeData'}),
                                    /\/helloworld\.nestmessage\.NestMessage\/ChangeData: verify failed on field `request\.args\.addressList\[0]\.district`\s+This field is missed in expected data/
                                );
                            });
                        });
                    });
                });
            });
        });
    });
});
