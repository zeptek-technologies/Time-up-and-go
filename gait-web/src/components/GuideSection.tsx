const GUIDE = [
  {
    cls: "low",
    title: "ความเสี่ยงต่ำ",
    desc: <>เวลารวม <strong>ไม่เกิน 11 วินาที</strong> - มักบ่งชี้ว่าการเคลื่อนไหวอยู่ในเกณฑ์ดี ผู้ทดสอบมีความมั่นคงในการทรงตัว</>,
  },
  {
    cls: "mod",
    title: "ความเสี่ยงปานกลาง",
    desc: <>เวลารวม <strong>มากกว่า 11 แต่ไม่เกิน 30 วินาที</strong> - มีความเสี่ยงต่อการหกล้ม ควรติดตามต่อเนื่อง อาจต้องปรึกษาแพทย์เพิ่มเติม</>,
  },
  {
    cls: "high",
    title: "ความเสี่ยงสูง",
    desc: <>เวลารวม <strong>มากกว่า 30 วินาที</strong> - มีความเสี่ยงสูงมากต่อการหกล้ม ควรประเมินร่วมกับบุคลากรทางการแพทย์โดยเร็ว</>,
  },
];

type LightStatus = {
  color: string;
  pattern: "steady" | "blink" | "blink-fast";
  light: string;
  meaning: string;
  action: string;
};

// ตารางนี้ต้องตรงกับไฟจริงใน ESP_Checkpoint_v2.ino (หัวข้อ "RGB LED + ไฟสถานะ")
// ไฟทั้งระบบมีดวงเดียว อยู่ที่กล่องจุดหมุนตัว - สีเดียวกันแต่คนละจังหวะ = คนละความหมาย
const LIGHT_GROUPS: { title: string; hint: string; items: LightStatus[] }[] = [
  {
    title: "1. ตอนเปิดเครื่อง",
    hint: "รอจนไฟหยุดกระพริบก่อนเริ่มทดสอบ",
    items: [
      {
        color: "blue",
        pattern: "blink",
        light: "สีน้ำเงินกระพริบ",
        meaning: "อุปกรณ์ยังไม่พร้อม - กำลังเปิดเครื่อง หรือยังต่อ Wi-Fi / ส่งข้อมูลขึ้นระบบ / ติดต่อกล่องที่เก้าอี้ไม่ได้",
        action: "รอสักครู่ ถ้ายังกระพริบนานผิดปกติ ให้ดูการ์ดสถานะอุปกรณ์บนหน้าเว็บว่าติดขั้นไหน - ตั้งค่า Wi-Fi ทำที่กล่องเก้าอี้ที่เดียว (Wi-Fi ชื่อ TUG-Chair-Setup) กล่องนี้จะรับค่าตามเอง",
      },
      {
        color: "blue",
        pattern: "steady",
        light: "สีน้ำเงินค้าง",
        meaning: "อุปกรณ์พร้อมใช้งานครบแล้ว",
        action: "พาผู้ทดสอบมานั่งที่เก้าอี้ในท่าเริ่มต้น",
      },
    ],
  },
  {
    title: "2. ระหว่างการทดสอบ",
    hint: "ไฟกลุ่มนี้เป็นสถานะปกติ ไม่ต้องแก้ไข",
    items: [
      {
        color: "green",
        pattern: "blink",
        light: "สีเขียวกระพริบ",
        meaning: "ผู้ทดสอบนั่งเรียบร้อยแล้ว ระบบพร้อมให้ลุก",
        action: "บอกผู้ทดสอบให้ลุกขึ้นเดินได้เลย เวลาจะเริ่มจับตอนลุกขึ้นจากเก้าอี้",
      },
      {
        color: "white",
        pattern: "blink-fast",
        light: "สีขาวกระพริบ",
        meaning: "กำลังจับเวลา - ผู้ทดสอบลุกเดินไปยังจุดหมุนตัว",
        action: "ปล่อยให้เดินตามปกติ ไม่ต้องกดอะไรเพิ่ม",
      },
      {
        color: "white",
        pattern: "steady",
        light: "สีขาวค้าง",
        meaning: "ผ่านจุดหมุนตัวแล้ว กำลังเดินกลับ",
        action: "ให้ผู้ทดสอบเดินกลับไปนั่งที่เก้าอี้ เวลาจะหยุดเมื่อนั่งลง",
      },
    ],
  },
  {
    title: "3. เมื่อการทดสอบจบ",
    hint: "ไฟค้างตามระดับผล 10 วินาที แล้วกลับเป็นน้ำเงินค้าง",
    items: [
      {
        color: "green",
        pattern: "steady",
        light: "สีเขียวค้าง",
        meaning: "ผลประเมิน: ความเสี่ยงต่ำ",
        action: "บันทึกผลและติดตามตามแผนปกติ",
      },
      {
        color: "amber",
        pattern: "steady",
        light: "สีเหลืองค้าง",
        meaning: "ผลประเมิน: ความเสี่ยงปานกลาง",
        action: "ควรมีผู้ดูแลใกล้ชิด และนำผลไปปรึกษาบุคลากรทางการแพทย์",
      },
      {
        color: "red",
        pattern: "steady",
        light: "สีแดงค้าง",
        meaning: "ผลประเมิน: ความเสี่ยงสูง",
        action: "ช่วยพยุงและดูแลใกล้ชิด พร้อมปรึกษาบุคลากรทางการแพทย์โดยเร็ว",
      },
    ],
  },
];

function LightSignal({ color, pattern }: Pick<LightStatus, "color" | "pattern">) {
  return (
    <span className={`light-signal light-signal--${color} light-signal--${pattern}`} aria-hidden="true">
      <span className="light-signal__bulb" />
    </span>
  );
}

export default function GuideSection() {
  return (
    <section className="guide-section" id="guide">
      <div className="section-header">
        <div>
          <span className="section-header__eyebrow">Interpretation Guide</span>
          <h3 className="section-header__title">วิธีอ่านผลและสถานะไฟ</h3>
        </div>
      </div>
      <div className="guide-subhead">
        <h4>อ่านผลการทดสอบ TUG</h4>
        <p>ใช้เวลารวมเป็นแนวทางเบื้องต้น และดูร่วมกับอาการจริงของผู้ทดสอบ</p>
      </div>
      <div className="guide-grid">
        {GUIDE.map((g) => (
          <article key={g.cls} className={`guide-card guide-card--${g.cls}`}>
            <div>
              <h4 className="guide-card__title">{g.title}</h4>
              <p className="guide-card__desc">{g.desc}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="light-guide">
        <div className="light-guide__intro">
          <div>
            <span className="section-header__eyebrow">Device Light Guide</span>
            <h4>ดูไฟที่กล่องแล้วทำตามนี้</h4>
          </div>
          <p><strong>ดูทั้งสีและจังหวะไฟ</strong> เพราะสีเดียวกันคนละความหมายเมื่อไฟค้างหรือกระพริบ เช่น เขียวกระพริบ = ลุกได้ ส่วนเขียวค้าง = ผลความเสี่ยงต่ำ (ไฟทั้งระบบมีดวงเดียว อยู่ที่กล่องจุดหมุนตัว)</p>
        </div>

        {LIGHT_GROUPS.map((group) => (
          <section className="light-group" key={group.title} aria-labelledby={`light-${group.title[0]}`}>
            <header className="light-group__header">
              <h5 id={`light-${group.title[0]}`}>{group.title}</h5>
              <p>{group.hint}</p>
            </header>
            <div className="light-list">
              <div className="light-list__head" aria-hidden="true">
                <span>ไฟที่เห็น</span>
                <span>หมายความว่า</span>
                <span>ควรทำอย่างไร</span>
              </div>
              {group.items.map((item) => (
                <article className="light-row" key={`${item.light}-${item.meaning}`}>
                  <div className="light-row__signal">
                    <LightSignal color={item.color} pattern={item.pattern} />
                    <strong>{item.light}</strong>
                  </div>
                  <p className="light-row__meaning">{item.meaning}</p>
                  <p className="light-row__action">{item.action}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
        <p className="light-guide__note">
          หากไฟไม่ตรงกับรายการนี้ หรือค้างอยู่ที่สถานะเดิมนานผิดปกติ ให้ปิด-เปิดอุปกรณ์ใหม่ทั้งชุดก่อนเริ่มทดสอบอีกครั้ง
        </p>
      </div>

      <footer className="footer">
        <p>TUG Care Board - Timed Up &amp; Go Monitoring System © 2026</p>
      </footer>
    </section>
  );
}
