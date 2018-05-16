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
                                date: new Date('2017-01-01'),
                                dbVal: 3.1415926
                            }
                        },
                        reply: {
                            reply: {
                                message: 'Hello, nick!',
                                title: 'CAO',
                                fltVal: 3.0,
                                date: new Date('2017-01-01 09:00:00'),
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
                                date: new Date('2017-01-01'),
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
                            date: new Date('2017-01-01'),
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
        },
        'helloworld.nestmessage.NestMessage': {
            changeData: [
                {
                    request: {
                        args: {
                            name: 'spock',
                            addressList: [
                                {
                                    name: 'kirk',
                                    province: 'A',
                                    city: 'enterprice'
                                },
                                {
                                    name: 'spock',
                                    province: 'A',
                                    city: 'enterprice'
                                },
                            ],
                            currentAddr: {
                                name: 'spock',
                                province: 'A',
                                city: 'enterprice'
                            }
                        }
                    },
                    reply: {
                        reply: {
                            name: 'spock',
                            addressList: [
                                {
                                    name: 'kirk',
                                    province: 'A',
                                    city: 'enterprice'
                                },
                                {
                                    name: 'spock',
                                    province: 'A',
                                    city: 'enterprice'
                                },
                            ],
                            currentAddr: {
                                name: 'spock',
                                province: 'A',
                                city: 'enterprice'
                            }
                        }
                    }
                },
                {
                    request: {
                        args: {
                            name: 'hanna',
                            addressList: [
                                {
                                    name: 'kirk',
                                    province: 'A',
                                    city: 'enterprice'
                                },
                                {
                                    name: 'spock',
                                    province: 'A',
                                    city: 'enterprice'
                                },
                            ],
                            currentAddr: {
                                name: 'spock',
                                province: 'A',
                                city: 'enterprice'
                            }
                        }
                    },
                    reply: {
                        error: {
                            code: 2000,
                            details: 'hanna is not here.'
                        }
                    }
                }
            ]
        }
    }
};
