import type { Context } from '@koishijs/client'
import TwitterConfigNavLoader from './TwitterConfigNavLoader.vue'
import SubscriptionTable from './components/SubscriptionTable.vue'

export default (ctx: Context) => {
  ctx.schema({
    type: 'array',
    role: 'twitter-user-subscriptions',
    component: SubscriptionTable,
  })
  ctx.schema({
    type: 'array',
    role: 'twitter-hashtag-subscriptions',
    component: SubscriptionTable,
  })
  ctx.slot({
    type: 'plugin-details',
    component: TwitterConfigNavLoader,
    order: -998,
  })
}
