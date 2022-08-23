import store from '../store'
import { StoredBot, addData, editData } from '../store/bots'
import { getPositionNextStatus, getOpenPositionMessage } from './utils'
import db, {
  Level,
  Order,
  Position,
  PositionStatus,
  OrderRule,
  LevelStatus,
  Log,
  DEFAULT_AVAILABLE_RULES,
} from '../db'
import { PlacedOrder } from '../api'
import { sendMessage } from '../telegram'

/**
 * Открытие новой позиции
 */
export const openPosition = async (
  placeOrder: () => Promise<PlacedOrder>,
  botId: StoredBot['id'],
  openLevel: Level,
  openingRule: OrderRule
) => {
  try {
    // отправляем заявку
    const placedOrder = await placeOrder()

    const availableRules = DEFAULT_AVAILABLE_RULES.filter(
      (rule) => rule !== openingRule
    )

    if (process.env.NODE_ENV === 'test') {
      store.dispatch(
        addData({
          botId,
          position: {
            openLevel,
            id: Math.floor(Math.random() * 666),
            status: PositionStatus.OPEN_PARTIAL,
            orders: [
              {
                id: Math.floor(Math.random() * 666),
                rule: openingRule,
                createdAt: new Date(),
                updatedAt: null,
                position: null,
                ...placedOrder,
              },
            ],
            availableRules,
            createdAt: new Date(),
            updatedAt: null,
            bot: null,
          },
        })
      )

      return
    }

    // сохраняем в бд
    const { manager } = db

    const order = await manager.save(
      manager.create(Order, { rule: openingRule, ...placedOrder })
    )

    const position = await manager.save(
      manager.create(Position, {
        openLevel,
        status: PositionStatus.OPEN_PARTIAL,
        availableRules,
        orders: [order],
        bot: { id: botId },
      })
    )

    // добавляем в стейт
    store.dispatch(
      addData({
        botId,
        position,
      })
    )

    const message = getOpenPositionMessage(botId, openLevel, openingRule)
    manager.save(manager.create(Log, { bot: { id: botId }, message }))
    sendMessage(message)
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      const message = JSON.stringify(error)

      sendMessage(message)

      const { manager } = db
      manager.save(manager.create(Log, { bot: { id: botId }, message }))
    }
  }
}

/**
 * Усреденение позиции
 */
export const averagingPosition = async (
  placeOrder: () => Promise<PlacedOrder>,
  botId: StoredBot['id'],
  position: Position,
  averagingRule: OrderRule
) => {
  const availableRules = position.availableRules.filter(
    (rule) => rule !== averagingRule
  )
  const status = getPositionNextStatus(availableRules)

  // блочим уровень, если позиция открыта полностью
  if (status === PositionStatus.OPEN_FULL) {
    store.dispatch(
      editData({
        botId,
        level: {
          id: position.openLevel.id,
          status: LevelStatus.DISABLED_DURING_SESSION,
        },
        position: {
          id: position.id,
          openLevel: {
            ...position.openLevel,
            status: LevelStatus.DISABLED_DURING_SESSION,
          },
        },
      })
    )
  }

  try {
    // отправляем заявку
    const placedOrder = await placeOrder()

    // обновляем позицию в стейте
    store.dispatch(
      editData({
        botId,
        position: {
          id: position.id,
          status,
          availableRules,
          orders: [
            ...position.orders,
            {
              id: Math.floor(Math.random() * 666),
              rule: averagingRule,
              createdAt: new Date(),
              updatedAt: null,
              position: null,
              ...placedOrder,
            },
          ],
        },
      })
    )

    if (process.env.NODE_ENV === 'test') return

    const { manager } = db

    // обновляем позицию в бд
    const order = await manager.save(
      manager.create(Order, { rule: averagingRule, ...placedOrder })
    )

    const { orders } = await manager.save(Position, {
      ...position,
      status,
      availableRules,
      orders: [...position.orders, order],
    })

    // обновляем заявки
    store.dispatch(
      editData({
        botId,
        position: {
          id: position.id,
          orders,
        },
      })
    )
  } catch (error) {
    // откатываем позицию в стейте
    store.dispatch(
      editData({
        botId,
        position,
      })
    )

    const message = JSON.stringify(error)

    sendMessage(message)

    const { manager } = db
    manager.save(manager.create(Log, { message }))
  }
}

export const closePosition = async (
  placeOrder: () => Promise<PlacedOrder>,
  botId: StoredBot['id'],
  position: Position,
  closingRule: OrderRule,
  disableLevel?: Level,
  closedLevel?: Level
) => {
  try {
    // отправляем заявку
    const placedOrder = await placeOrder()

    // обновляем стейт
    store.dispatch(
      editData({
        botId,
        position: {
          id: position.id,
          orders: [
            ...position.orders,
            {
              id: Math.floor(Math.random() * 666),
              rule: closingRule,
              createdAt: new Date(),
              updatedAt: null,
              position: null,
              ...placedOrder,
            },
          ],
          status: PositionStatus.CLOSED,
          closedLevel: disableLevel
            ? {
                ...disableLevel,
                status: LevelStatus.DISABLED_DURING_SESSION,
              }
            : closedLevel,
        },
        level: disableLevel
          ? {
              id: disableLevel.id,
              status: LevelStatus.DISABLED_DURING_SESSION,
            }
          : undefined,
      })
    )

    if (process.env.NODE_ENV === 'test') return

    // обновляем позицию в бд
    const { manager } = db

    const order = await manager.save(
      manager.create(Order, { rule: closingRule, ...placedOrder })
    )

    const { orders } = await manager.save(Position, {
      ...position,
      closedLevel,
      status: PositionStatus.CLOSED,
      orders: [...position.orders, order],
    })

    // обновляем заявки
    store.dispatch(
      editData({
        botId,
        position: {
          id: position.id,
          orders,
        },
      })
    )
  } catch (error) {
    const message = JSON.stringify(error)

    sendMessage(message)

    const { manager } = db
    manager.save(manager.create(Log, { message }))
  }
}

export const updatePositionAvaiableRules = async (
  botId: StoredBot['id'],
  position: Position,
  availableRules: Position['availableRules']
) => {
  store.dispatch(
    editData({
      botId,
      position: {
        id: position.id,
        availableRules,
      },
    })
  )

  if (process.env.NODE_ENV === 'test') return

  try {
    const { manager } = db
    await manager.update(Position, position.id, { availableRules })
  } catch (error) {
    store.dispatch(
      editData({
        botId,
        position,
      })
    )
  }
}
