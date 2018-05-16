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
                'helloworld.proto'
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

    const errorAssert = (data, expectation) => {
        assert.nestedPropertyVal(
            data,
            'expectation.reply.error.code',
            expectation.reply.error.code
        );
        assert.nestedPropertyVal(
            data,
            'expectation.reply.error.details',
            expectation.reply.error.details
        );
        assert.equal(data.expectation.reply.reply, null);
    };
    const replyAssert = (data, expectation) => {

        assert.deepNestedInclude(data, {
            'expectation.reply.reply': expectation.reply.reply
        });
        assert.equal(data.expectation.reply.error, null);
    };

    describe('Collector', () => {
        describe('#exec()', () => {
            it('should return the collected data produced by interactions', async () => {
                collector = await consumer(getServerOpts());
                const data = await collector.exec();
                const results = data.contracts;
                contract = collector.contract;
                assert.typeOf(results, 'Object');
                const result = results['helloworld.Greeter'];
                const expectation = contract.contracts['helloworld.Greeter'];

                // request
                const lengths = {
                    throwAnErr: 1,
                    sayHello: 2,
                };
                ['throwAnErr', 'sayHello'].forEach(method => {
                    assert.property(result, method);
                    assert.lengthOf(result[method], lengths[method]);
                    assert.nestedProperty(expectation, `${method}.executions`);
                    assert.lengthOf(expectation[method].executions, lengths[method]);
                    result[method].forEach((obj, i) => {
                        const e = expectation[method].executions[i];
                        assert.deepNestedInclude(obj, {[`expectation.request.args`]: e.request.args});
                    });
                });

                errorAssert(result.throwAnErr[0], expectation.throwAnErr.executions[0]);
                replyAssert(result.sayHello[0], expectation.sayHello.executions[0]);
                errorAssert(result.sayHello[1], expectation.sayHello.executions[1]);
            });

            context('when `Collector.prototype.assertOpts()` is assigned', () => {
                let i;
                let outputFile = PATH.join(__dirname, 'contract.json');

                beforeEach(async () => {
                    // consumer create the contract file
                    collector = await consumer(getServerOpts());
                    await collector.exec({}, {outputFile});
                });

                beforeEach(async () => {
                    if (collector) {
                        await collector.clearup();
                    }
                });

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
                                        assert.deepEqual(assertion, expectation);
                                        i++;
                                    },
                                    errorFields: ['code']
                                }
                            }
                        )
                    );
                });
                afterEach(() => fs.unlinkSync(outputFile));
                afterEach(() => collector.clearup());

                it('provider should satisfy the contract', async () => {
                    await collector.exec();
                    assert.equal(i, 3);
                });
            });
        });
    });
});
