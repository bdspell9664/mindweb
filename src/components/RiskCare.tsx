/**
 * 危险念头的固定陪伴区块。
 * 刻意不用红色警告、不做评分、不排名——只把人和一条能拨通的线放在一起。
 */
export default function RiskCare() {
  return (
    <div className="risk-care">
      <p>
        这个念头又回来了。你不必现在就想明白它，也不必一个人待着它旁边。
        如果它变得很重，或者你担心自己，可以随时找人说说话：
      </p>
      <div className="hotline">
        <span>全国心理援助热线</span>
        <span>12356</span>
      </div>
      <div className="hotline">
        <span>北京心理危机干预中心</span>
        <span>010-82951332</span>
      </div>
      <p className="soft">
        两条线都是 24 小时的，打过去不需要理由，也不需要先组织语言。
        如果此刻就在危险里，请先离开手边能伤到自己的东西，再拨号。
      </p>
    </div>
  );
}
