"""后台静态导出的时间轴样式，使用与画布相同的节点类名和装饰度量。"""

TIMELINE_CSS = """
.td-timeline { display: block; position: relative; min-width: 0; margin: 12px 0; }
.td-timeline-item { display: block; position: relative; min-width: 0; padding: 0 0 var(--td-timeline-padding-bottom, 20px) var(--td-timeline-padding-left, 24px); }
.td-timeline > .td-timeline-item:last-child { padding-bottom: 0; }
.td-timeline-body { display: block; min-width: 0; overflow-wrap: anywhere; }
.td-timeline-body .td-column > :first-child { margin-top: 0; }
.td-timeline-body > :first-child { margin-top: 0; }
.td-timeline-body > :last-child { margin-bottom: 0; }
.td-timeline-dot { position: absolute; box-sizing: border-box; left: 4px; top: 8px; width: 8px; height: 8px; border: 2px solid #2563eb; border-radius: 50%; background-color: white; pointer-events: none; }
.td-timeline > .td-timeline-item:first-child > .td-timeline-dot { background-color: #2563eb; }
.td-timeline-line { position: absolute; left: 7px; top: 12px; bottom: -12px; width: 0; border-left: 1px solid #cbd9f3; pointer-events: none; }
.td-timeline > .td-timeline-item:last-child > .td-timeline-line { display: none; }
"""
