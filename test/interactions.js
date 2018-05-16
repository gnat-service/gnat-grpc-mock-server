module.exports = {
    provider: 'provider',
    consumer: 'consumer',
    contracts: {
        'helloworld.Greeter': {
            sayHello: {
                executions: [
                    {
                        request: {
                            args: {
                                name: 'nick',
                                position: '122,322',
                                date: new Date(),
                                dbVal: 3.1415926
                            }
                        },
                        reply: {
                            reply: {
                                message: 'Hello, nick!',
                                title: 'CAO',
                                fltVal: 3.0,
                                date: new Date()
                            },
                            // handler (request, metadata, {setTrailer, setFlags}, call) {
                            //
                            // }
                        }
                    },
                    {
                        request: {
                            args: {
                                name: 'Jane',
                                position: '122,322',
                                date: new Date(),
                                dbVal: 3.1415926
                            }
                        },
                        reply: {
                            error: {
                                code: 2000,
                                details: 'user `Jane` not exists'
                            }
                        }
                    }
                ]
            },
            throwAnErr: [
                {
                    request: {
                        args: {
                            name: 'hanna',
                            position: '122,322',
                            date: new Date(),
                            dbVal: 32.3
                        }
                    },
                    reply: {
                        error: {
                            code: 14,
                            details: 'Unknown Error'
                        }
                    }
                }
            ]
        }
    }
};
