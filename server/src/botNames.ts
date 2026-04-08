// Bot display names — pick from this list randomly, prefixed with "机器人："
export const BOT_NAMES = [
  '曹操', '典韦', '许褚', '张辽', '张郃', '徐晃', '庞德', '夏侯惇', '夏侯渊',
  '刘备', '关羽', '张飞', '赵云', '马超', '黄忠', '魏延', 
  '孙权', '孙策', '太史慈', '甘宁', '周泰',
  '吕布', '颜良', '文丑', 
  
  '司马懿', '郭嘉', '贾诩', '荀彧', '荀攸', '程昱', '杨修', '邓艾', '钟会',
  '诸葛亮', '庞统', '法正', '姜维', '徐庶', 
  '周瑜', '鲁肃', '吕蒙', '陆逊', 
  '田丰', '沮授', '陈宫',
];


/**
 * Pick a bot name that isn't already used in the room.
 * Returns "机器人：XXXX" format.
 */
export function pickBotName(usedNames: string[]): string {
  const available = BOT_NAMES.filter(
    (n) => !usedNames.includes(`机：${n}`)
  );
  if (available.length === 0) {
    // Fallback: just use a number suffix
    let i = 1;
    while (usedNames.includes(`机${i}`)) i++;
    return `机${i}`;
  }
  return `机：${available[Math.floor(Math.random() * available.length)]}`;
}
