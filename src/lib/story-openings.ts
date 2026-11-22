export interface StoryOpeningCard {
  id: string;
  templateId: string;
  modeId: string;
  difficultyId: string;
  location: string;
  incitingEvent: string;
  immediatePressure: string;
  relationship: string;
  anomaly: string;
  personalGoal: string;
  firstChoice: string;
}

interface StoryOpeningSeed {
  id: string;
  location: string;
  incitingEvent: string;
  immediatePressure: string;
  relationship: string;
  anomaly: string;
  personalGoal: string;
  firstChoice: string;
}

const STORY_OPENING_SEEDS: Record<string, StoryOpeningSeed[]> = {
  cultivation: [
    {
      id: "borrowed-name-funeral",
      location: "雨中宗门灵堂",
      incitingEvent: "棺中死者突然睁眼，叫出了主角早已舍弃的俗世姓名",
      immediatePressure: "执事要求所有人不得离开，并逐个查验身份玉牌",
      relationship: "死者是当年拒绝收主角为徒、却暗中资助过主角的长老",
      anomaly: "棺盖内侧刻着主角尚未学会的剑诀",
      personalGoal: "在身份暴露前拿走长老留下的证据",
      firstChoice: "上前验尸，或趁灯灭截住送葬弟子",
    },
    {
      id: "double-lottery",
      location: "宗门大比抽签台",
      incitingEvent: "签筒里滚出两根完全相同的签，其中一根沾着新鲜血迹",
      immediatePressure: "下一场比试已经开始，叫到了主角的姓名",
      relationship: "另一个持签者是与主角同住多年、最信任的同门",
      anomaly: "记录签号的玉册上，主角的对手早已被写成死人",
      personalGoal: "查清是谁替换了签号并避免被当作舞弊者",
      firstChoice: "当众验签，或先答应暗中换场",
    },
    {
      id: "drained-field",
      location: "黎明前的宗门灵田",
      incitingEvent: "主角巡田时发现所有灵植在数息间枯萎，根系却指向自己住处",
      immediatePressure: "巡山长老正带着戒律堂弟子赶来，罪名可能直接落在主角身上",
      relationship: "负责灵田的师兄曾借给主角一枚保命玉佩",
      anomaly: "枯井里传来与主角相同节奏的呼吸声",
      personalGoal: "找到灵气流失的真正方向",
      firstChoice: "跟随根系追查，或先回住处处理证据",
    },
    {
      id: "dead-master-letter",
      location: "废弃传灯阁",
      incitingEvent: "一封署名为已故师父的信从封印阵中自行飞出，收信人正是主角",
      immediatePressure: "信纸遇灵气即燃，只剩三十息时间阅读",
      relationship: "师父生前最器重的另一位弟子正在门外敲门",
      anomaly: "信中描述的事情发生在三天后",
      personalGoal: "记下警告又不让门外之人知道信的存在",
      firstChoice: "立刻朗读信中内容，或先藏信并误导门外之人",
    },
    {
      id: "debt-collector",
      location: "山脚药材铺",
      incitingEvent: "讨债的修士把一张借据拍在柜台上，担保人竟是主角",
      immediatePressure: "掌柜准备封店，病重的药童还等着药钱",
      relationship: "担保人曾是主角的救命恩人，已经失踪两年",
      anomaly: "借据上的墨迹仍在变化，欠款数字不断上涨",
      personalGoal: "在药材被搬空前确认借据是否为伪造",
      firstChoice: "扣下借据查验，或先保住药童需要的药材",
    },
    {
      id: "auction-heirloom",
      location: "城中地下拍卖会",
      incitingEvent: "拍卖师掀开红布，台上摆着主角幼年遗失、绝不可能流出的旧物",
      immediatePressure: "所有贵客开始竞价，主办方同时封锁出口寻找泄密者",
      relationship: "鉴定席上的女修认出了旧物，却替主角隐藏了名字",
      anomaly: "旧物里传出一段主角从未经历过的记忆",
      personalGoal: "在不暴露身份的情况下拿回旧物",
      firstChoice: "参与竞价，或跟踪托举拍品的侍者",
    },
  ],
  apocalypse: [
    {
      id: "radio-own-voice",
      location: "积水的废弃地铁控制室",
      incitingEvent: "坏掉的无线电突然用主角的声音播报三小时后会发生的死亡名单",
      immediatePressure: "门外有变异体循着声音靠近，电量只剩最后几分钟",
      relationship: "名单第一个名字是曾救过主角的失踪队友",
      anomaly: "控制台时钟比现实快了整整一天",
      personalGoal: "确认广播来源并决定是否相信名单",
      firstChoice: "立刻呼叫名单上的人，或拆开无线电追踪信号",
    },
    {
      id: "missing-patrol",
      location: "基地东侧铁门",
      incitingEvent: "外出巡逻队全员返回，却比出发时多出了一个人",
      immediatePressure: "门卫拒绝开门，门外变异群正在逼近",
      relationship: "多出来的人穿着主角已经亲手埋葬的旧友外套",
      anomaly: "巡逻车辆里没有任何灰尘和血迹",
      personalGoal: "辨认队伍里谁已经不再是人类",
      firstChoice: "只放队长进门询问，或打开侧门让所有人先撤",
    },
    {
      id: "future-rations",
      location: "地下仓库",
      incitingEvent: "清点物资时，主角发现一批罐头印着明年才生产的日期",
      immediatePressure: "仓库管理员要求立刻登记为可食用物资",
      relationship: "管理员是掌握基地水源钥匙的人",
      anomaly: "每个罐头底部都刻着不同幸存者的名字",
      personalGoal: "查明物资来源，同时避免引起抢粮",
      firstChoice: "偷偷打开一罐送检，或公开日期要求封仓",
    },
    {
      id: "child-with-code",
      location: "废墟医院",
      incitingEvent: "一个失语孩子递给主角一张写着基地暗号的纸",
      immediatePressure: "远处的感染者正在沿救护车通道聚拢",
      relationship: "暗号只有主角和三名核心成员知道",
      anomaly: "孩子口袋里装着基地尚未制成的新式钥匙",
      personalGoal: "把孩子带回基地之前确认这是否是渗透陷阱",
      firstChoice: "立即带走孩子，或先搜寻找出跟踪者",
    },
    {
      id: "poisoned-water",
      location: "屋顶蓄水塔",
      incitingEvent: "主角发现水塔滤芯被人拆走，水中漂着一枚基地内部徽章",
      immediatePressure: "二十分钟后全基地就会开始接水",
      relationship: "徽章属于今早主动申请值夜的年轻守卫",
      anomaly: "检测试纸显示水中有能提高体能的未知物质",
      personalGoal: "阻止供水又不让基地陷入恐慌",
      firstChoice: "关闭总阀并追查守卫，或先寻找替代水源",
    },
    {
      id: "convoy-offer",
      location: "北环高架下的交易点",
      incitingEvent: "陌生车队拿出一箱能治疗感染的药，只要求交换基地地图",
      immediatePressure: "基地里的重症伤员只能再撑一天",
      relationship: "车队领队认识主角失踪的家人",
      anomaly: "药箱上的运输编号来自基地三个月前失守的分部",
      personalGoal: "在不泄露防御布局的情况下拿到药",
      firstChoice: "交出一份假地图，或先追问失踪家人的消息",
    },
  ],
  urban: [
    {
      id: "future-photo",
      location: "凌晨的公司电梯",
      incitingEvent: "陌生号码发来一张照片，主角正站在照片里尚未到达的十二楼",
      immediatePressure: "电梯没有经过十二楼却自行停下，门正在缓慢打开",
      relationship: "发件号码属于三个月前离职、与主角发生过争执的同事",
      anomaly: "照片角落里显示的时间是明天",
      personalGoal: "在别人发现异常前查清照片来源",
      firstChoice: "走出电梯查看，或立刻按住关门键",
    },
    {
      id: "dead-boss-offer",
      location: "旧城区共享办公空间",
      incitingEvent: "主角收到一份薪酬丰厚的合同，签名却是已经去世的老板",
      immediatePressure: "客户代表就在门外，要求今早给出是否接单的答复",
      relationship: "推荐这份工作的中间人是主角多年未见的朋友",
      anomaly: "合同附带的办公室钥匙仍带着旧办公室的雨腥味",
      personalGoal: "在不失去机会的情况下确认合同背后的委托人",
      firstChoice: "先见客户，或去旧办公室查钥匙",
    },
    {
      id: "wrong-transfer",
      location: "创业公司会议室",
      incitingEvent: "财务发现客户刚打来的第一笔款来自一个已注销的账户",
      immediatePressure: "投资人视频会议在十分钟后开始，账目必须给出解释",
      relationship: "取消失败的付款人是合伙人的亲属",
      anomaly: "合同扫描件里多了主角从未同意的一条对赌条款",
      personalGoal: "保住融资同时找到谁修改了合同",
      firstChoice: "暂停会议公开问题，或先让财务追踪账户",
    },
    {
      id: "audition-scandal",
      location: "老剧院后台",
      incitingEvent: "试镜开始前，主角发现自己上了热搜，视频里的行为从未真实发生过",
      immediatePressure: "导演要求和主角单独谈谈，媒体已经堵住正门",
      relationship: "发布视频的营销号属于竞争演员的经纪团队",
      anomaly: "视频背景里出现了今晚才布置的舞台道具",
      personalGoal: "找到原始视频并保住试镜机会",
      firstChoice: "从消防通道追营销号，或留下向导演解释",
    },
    {
      id: "package-old-name",
      location: "下班后的公寓门口",
      incitingEvent: "快递箱上写着主角十年前使用的旧名字，寄件地址则是当前住址",
      immediatePressure: "楼道监控突然失灵，邻居家门缝里有人盯着箱子",
      relationship: "邻居是唯一知道主角曾经改名的人",
      anomaly: "箱子里的手机正在直播主角此刻的画面",
      personalGoal: "关掉直播并找出寄件者",
      firstChoice: "立刻报警并封住箱子，或先质问邻居",
    },
    {
      id: "recording-passenger",
      location: "末班地铁",
      incitingEvent: "邻座乘客塞给主角一支录音笔后匆匆下车，几秒后站台传来急刹声",
      immediatePressure: "列车即将离站，录音笔正在自动播放",
      relationship: "录音中的声音属于主角最重要的合作对象",
      anomaly: "录音准确描述了接下来五分钟会发生的事",
      personalGoal: "带着录音离开并确认合作对象是否安全",
      firstChoice: "冲下车追乘客，或留在车上听完录音",
    },
  ],
  folklore: [
    {
      id: "corpse-calls-name",
      location: "雨夜灵堂",
      incitingEvent: "停灵三日的老人突然坐起，隔着白布准确叫出主角的名字",
      immediatePressure: "守灵人全部跪下，要求主角按旧规矩替老人“答名”",
      relationship: "老人是唯一知道主角身世的人",
      anomaly: "棺材底部已经积满当夜才会落下的纸灰",
      personalGoal: "拒绝答名又不破坏灵堂规矩",
      firstChoice: "掀开白布查看，或先问守灵人规矩是谁定的",
    },
    {
      id: "masked-faces",
      location: "河堤边的傩戏台",
      incitingEvent: "台上所有演员转身时戴着同一张主角童年制作的面具",
      immediatePressure: "领班邀请主角上台扮演尚未出现的“引路人”",
      relationship: "台下唯一没有鼓掌的人是多年未见的亲戚",
      anomaly: "河水正倒流回戏台，岸边所有人却毫无察觉",
      personalGoal: "查明面具来源并安全离场",
      firstChoice: "接受角色上台，或跟着亲戚离开河堤",
    },
    {
      id: "changed-records",
      location: "祠堂后的档案屋",
      incitingEvent: "祖辈留下的仪式记录被重新抄写，新增的一条禁令写着主角的死期",
      immediatePressure: "村中铜锣响起，按规矩所有知情人必须去祠堂",
      relationship: "管理钥匙的族老一直反对主角接触旧记录",
      anomaly: "墨迹仍然温热，抄写者却刚刚从外面锁门",
      personalGoal: "带走原页并找到是谁伪造记录",
      firstChoice: "藏在档案屋等待，或撬窗跟踪族老",
    },
    {
      id: "red-wedding",
      location: "正午的废弃戏院",
      incitingEvent: "主角误入一场正在举行的红事，宾客却在每张桌上摆放白蜡烛",
      immediatePressure: "司仪宣布新娘入场，所有人都看向门口的主角",
      relationship: "新娘照片与主角失踪多年的朋友一模一样",
      anomaly: "戏院外明明是正午，门内钟表却指向午夜",
      personalGoal: "在不触犯仪式的情况下带走新娘",
      firstChoice: "配合仪式观察，或立刻吹灭最近的白蜡烛",
    },
    {
      id: "river-goods",
      location: "封航的旧码头",
      incitingEvent: "河面漂来一排贴着主角姓名的物件，全是家中多年前丢掉的东西",
      immediatePressure: "打捞人催主角认领，否则就要当场焚烧",
      relationship: "打捞人戴着主角去世亲人的手套",
      anomaly: "每件物品内部都塞着同一天的船票",
      personalGoal: "找回物件里指向失踪亲人的线索",
      firstChoice: "先认领一件，或夺过火把查看其余物品",
    },
    {
      id: "photographer-knows-you",
      location: "山城旅馆登记处",
      incitingEvent: "一位外地摄影师拿出二十年前的照片，照片里所有人都在，唯独主角没有变老",
      immediatePressure: "旅馆老板准备报警，摄影师却要求主角今晚跟他上山",
      relationship: "摄影师声称认识主角已经去世的长辈",
      anomaly: "登记簿上已经提前写好了主角明日的离店时间",
      personalGoal: "确认照片真伪并找出摄影师的目的",
      firstChoice: "扣下照片逼问，或假装答应并暗中准备护身物",
    },
  ],
};

const DIFFICULTY_GUIDANCE: Record<string, string> = {
  easy:
    "开场事件必须紧迫，但要留下一个明显可抓住的转机；不要用必死局面压迫玩家。",
  normal:
    "开场要有清楚危险和代价，同时保留调查、交涉、逃离等不同处理路线。",
  hard:
    "开场已经造成实际损失或倒计时，资源必须紧缺，错误选择要立即产生后果。",
  hell:
    "开场直接处在致命边缘，救援不能免费出现，第一个选择应在两种风险之间取舍。",
  custom:
    "开场必须落实玩家自定义难度规则，同时保持角色和世界逻辑一致。",
};

export function sanitizeStoryOpeningCard(
  value: unknown,
): StoryOpeningCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const text = (key: string, maximum: number) =>
    typeof input[key] === "string" ? input[key].trim().slice(0, maximum) : "";
  const card: StoryOpeningCard = {
    id: text("id", 100),
    templateId: text("templateId", 40),
    modeId: text("modeId", 40),
    difficultyId: text("difficultyId", 20),
    location: text("location", 80),
    incitingEvent: text("incitingEvent", 180),
    immediatePressure: text("immediatePressure", 180),
    relationship: text("relationship", 180),
    anomaly: text("anomaly", 180),
    personalGoal: text("personalGoal", 140),
    firstChoice: text("firstChoice", 180),
  };
  return card.id &&
    card.templateId &&
    card.location &&
    card.incitingEvent &&
    card.immediatePressure
    ? card
    : null;
}

export function createStoryOpeningCard(input: {
  templateId: string;
  modeId: string;
  difficultyId: string;
  excludeIds?: string[];
}): StoryOpeningCard | null {
  const seeds = STORY_OPENING_SEEDS[input.templateId] ?? [];
  if (seeds.length === 0) return null;
  const excluded = new Set(input.excludeIds ?? []);
  const available = seeds.filter((seed) => !excluded.has(seed.id));
  const pool = available.length > 0 ? available : seeds;
  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  const seed = pool[random % pool.length];
  return {
    id: seed.id,
    templateId: input.templateId,
    modeId: input.modeId,
    difficultyId: input.difficultyId,
    location: seed.location,
    incitingEvent: seed.incitingEvent,
    immediatePressure: seed.immediatePressure,
    relationship: seed.relationship,
    anomaly: seed.anomaly,
    personalGoal: seed.personalGoal,
    firstChoice: seed.firstChoice,
  };
}

export function restoreStoryOpeningCard(input: {
  id: string;
  templateId: string;
  modeId: string;
  difficultyId: string;
}): StoryOpeningCard | null {
  const seed = (STORY_OPENING_SEEDS[input.templateId] ?? []).find(
    (candidate) => candidate.id === input.id,
  );
  if (!seed) return null;
  return {
    id: seed.id,
    templateId: input.templateId,
    modeId: input.modeId,
    difficultyId: input.difficultyId,
    location: seed.location,
    incitingEvent: seed.incitingEvent,
    immediatePressure: seed.immediatePressure,
    relationship: seed.relationship,
    anomaly: seed.anomaly,
    personalGoal: seed.personalGoal,
    firstChoice: seed.firstChoice,
  };
}

export function getStoryOpeningGuidance(difficultyId: string) {
  return DIFFICULTY_GUIDANCE[difficultyId] ?? DIFFICULTY_GUIDANCE.normal;
}
