import { useEffect, useRef } from 'react';
import { echarts, type EChartsCoreOption } from './echarts';

interface ChartProps {
  option: EChartsCoreOption;
  height?: number;
  /** Accessible description of what the chart shows. */
  ariaLabel: string;
  onClick?: (params: { dataIndex: number; seriesIndex?: number; data: unknown; name: string }) => void;
}

/** Thin ECharts wrapper that resizes with its container. */
export function Chart({ option, height = 280, ariaLabel, onClick }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    const el = ref.current!;
    const chart = echarts.init(el, undefined, { renderer: 'svg' });
    instance.current = chart;
    chart.on('click', (params) => clickRef.current?.(params as never));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    instance.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={ref} className="chart" style={{ height }} role="img" aria-label={ariaLabel} />;
}
