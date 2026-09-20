import { summarizeDay } from '../../lib/analysis'
import { DecisionsView } from './DecisionsView'

export function Dashboard({ dataset, day, history = [] }) {
  summarizeDay(dataset, day)
  return <DecisionsView dataset={dataset} day={day} history={history} />
}
