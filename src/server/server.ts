import { ApolloServer } from 'apollo-server'

import store from '../store'
import typeDefs from './typeDefs'
import resolvers from './resolvers'

const context = { store }
export type Context = typeof context

export const startServer = () => {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context,
  })

  return server.listen({ port: process.env.PORT })
}
