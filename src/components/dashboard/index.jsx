import { Footprints, HeartPulse, MoonStar, Sparkles, Wind } from 'lucide-react'
import { summarizeDay } from '../../lib/analysis'
import { ActivityView } from './ActivityView'
import { HeartView } from './HeartView'
import { Overview } from './Overview'
import { SleepView } from './SleepView'
import { VitalsView } from './VitalsView'

export const VIEW_ITEMS = [
  { id: 'overview', label: 'Synthèse', icon: Sparkles },
  { id: 'sleep', label: 'Sommeil', icon: MoonStar },
  { id: 'heart', label: 'Cœur', icon: HeartPulse },
  { id: 'vitals', label: 'Mesures', icon: Wind },
  { id: 'activity', label: 'Activité', icon: Footprints },
]

export function Dashboard({ dataset, day, view, privateGps = [], history = [] }) {
  const summary = summarizeDay(dataset, day)
  const views = {
    overview: <Overview dataset={dataset} day={day} summary={summary} history={history} />,
    sleep: <SleepView dataset={dataset} day={day} summary={summary} />,
    heart: <HeartView dataset={dataset} day={day} summary={summary} />,
    vitals: <VitalsView dataset={dataset} day={day} summary={summary} />,
    activity: <ActivityView dataset={dataset} day={day} summary={summary} privateGps={privateGps} />,
  }
  return views[view] || views.overview
}
