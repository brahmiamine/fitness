import { DecisionsView } from './DecisionsView'

export function Dashboard({ dataset, day, history = [] }) {
  return <DecisionsView dataset={dataset} day={day} history={history} />
}
