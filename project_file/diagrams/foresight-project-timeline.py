"""Generate the report timeline SVG from documented Git activity dates."""

from datetime import date, timedelta
from pathlib import Path
from xml.sax.saxutils import escape


INCREMENTS = (
    ("Initial MVP and firmware", date(2026, 8, 29), date(2026, 8, 30)),
    ("Deployment and playback", date(2026, 8, 31), date(2026, 9, 2)),
    ("Monitoring and dashboard", date(2026, 11, 22), date(2026, 11, 23)),
)

START = INCREMENTS[0][1]
END = INCREMENTS[-1][2] + timedelta(days=1)
LEFT, RIGHT = 360, 1056


def x(day):
    return LEFT + (day - START).days / (END - START).days * (RIGHT - LEFT)


def label(value, left, top, size, color="#171717", *, anchor="start", bold=False):
    weight = 700 if bold else 400
    return (
        f'<text x="{left:.2f}" y="{top}" text-anchor="{anchor}" '
        f'font-size="{size}" font-weight="{weight}" fill="{color}">'
        f'{escape(value)}</text>'
    )


def render():
    elements = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="350" '
        'viewBox="0 0 1120 350" role="img" aria-labelledby="title">',
        '<title id="title">Foresight repository activity timeline</title>',
        '<rect width="1120" height="350" fill="#fff"/>',
        '<g font-family="Arial, sans-serif">',
        label("Foresight | Project timeline", 35, 52, 30, bold=True),
        label("Documented Git activity · 2026", 36, 81, 17, "#333333"),
    ]
    for row_y in (114, 176, 238, 300):
        elements.append(
            f'<path d="M36 {row_y}H1056" stroke="#d4d4d4" stroke-width="1"/>'
        )

    ticks = (
        (START, "29 Aug", "start"),
        (date(2026, 10, 1), "1 Oct", "middle"),
        (date(2026, 11, 1), "1 Nov", "middle"),
        (END, "23 Nov", "end"),
    )
    for day, caption, anchor in ticks:
        left = x(day)
        elements.append(
            f'<path d="M{left:.2f} 114V300" stroke="#d4d4d4" stroke-width="1"/>'
        )
        elements.append(label(caption, left, 326, 15, "#333333", anchor=anchor))

    for index, (name, start, end) in enumerate(INCREMENTS):
        top = 114 + index * 62
        left = x(start)
        width = x(end + timedelta(days=1)) - left
        period = (
            f"{start.day}–{end.day} {end:%b}"
            if start.month == end.month
            else f"{start.day} {start:%b}–{end.day} {end:%b}"
        )
        elements.extend((
            label(name, 36, top + 26, 20, bold=True),
            label(period, 36, top + 48, 16, "#333333"),
            f'<rect x="{left:.2f}" y="{top + 20}" width="{width:.2f}" '
            'height="22" rx="3" fill="#222222"/>',
        ))

    return "\n".join((*elements, "</g>", "</svg>", ""))


if __name__ == "__main__":
    Path(__file__).with_suffix(".svg").write_text(render(), encoding="utf-8")
