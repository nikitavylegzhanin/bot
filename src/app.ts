import InvestSDK, { OperationType } from '@tinkoff/invest-openapi-js-sdk'
import reduxDevTools from '@redux-devtools/cli'
import { Connection } from 'typeorm'
import { pick, not, isNil, pipe, reduce, filter, uniq, without } from 'ramda'

import store from './store'
import { initLevels, addLevels } from './store/levels'
import { initTrends } from './store/trends'
import { initPositions } from './store/positions'
import { Level, Trend, Position } from './db'
import { selectConfig, editConfig } from './store/config'
import { runStartegy } from './strategy'

const getRelatedLevels = pipe(
  reduce<Position, Level[]>(
    (arr, position) => [...arr, position.openLevel, position.closedLevel],
    []
  ),
  filter(pipe(isNil, not)),
  uniq
)

const getApiConfig = (isSandbox: boolean) => ({
  apiURL: process.env[isSandbox ? 'API_URL_SANDBOX' : 'API_URL'],
  secretToken: process.env[isSandbox ? 'API_TOKEN_SANDBOX' : 'API_TOKEN'],
  socketURL: process.env.API_URL_WS,
})

export const initApp = async ({ manager }: Connection) => {
  const config = selectConfig(store.getState())
  const api = new InvestSDK(getApiConfig(config.isSandbox))
  const { figi } = await api.searchOne({ ticker: config.ticker })

  store.dispatch(editConfig({ figi }))

  // Init levels, trends, positions
  const levels = await manager.find(Level)
  store.dispatch(initLevels(levels.map(pick(['id', 'value']))))

  const trends = await manager.find(Trend)
  store.dispatch(initTrends(trends.map(pick(['id', 'direction', 'type']))))

  const positions = await manager.find(Position, {
    relations: ['openLevel', 'closedLevel'],
  })
  store.dispatch(
    initPositions(
      positions.map((position) => ({
        ...pick(['id', 'closingRules', 'closedByRule', 'status'], position),
        openLevelId: position.openLevel?.id,
        closedLevelId: position.closedLevel?.id,
      }))
    )
  )

  // Add related levels if not loaded
  const relatedLevels = without(levels, getRelatedLevels(positions))
  if (relatedLevels.length) {
    store.dispatch(addLevels(relatedLevels.map(pick(['id', 'value']))))
  }

  if (config.isSandbox) {
    await api.sandboxClear()
    await api.setCurrenciesBalance({ currency: 'USD', balance: 100 })
  }

  return api
}

export const subscribePrice = (api: InvestSDK) => {
  const state = store.getState()
  const { figi } = selectConfig(state)

  let ask = 0,
    bid = 0

  const placeOrder = (operation: OperationType) =>
    api.marketOrder({ figi, operation, lots: 1 })

  return api.orderbook({ figi, depth: 1 }, ({ asks, bids }) => {
    const [lastAsk] = asks[0]
    const [lastBid] = bids[0]

    // обрабатываем торговую логику при изменении цены
    if (ask !== lastAsk || bid !== lastBid) {
      ask = lastAsk
      bid = lastBid

      runStartegy(ask, bid, placeOrder)
    }
  })
}

export const startReduxDevTool = () =>
  reduxDevTools({ hostname: 'localhost', port: 8000 })
