const ATL_ROOT = process.env.ATL_ROOT ? require('path').resolve(process.env.ATL_ROOT) : require('path').join(__dirname, '..');
// 回归测试：证明「静态初始化不许读配置」这条检查**真的会报警**。
//
// 为什么必须有这个文件：检查脚本"通过"本身不构成证据 ——
// 一个永远返回成功的检查，和一个真正管用的检查，输出长得一模一样。
// 上一轮的 check-no-config-at-registration.js 只扫 registry/*.java，
// 结果游戏启动崩在 RodItem$RodSpec.<clinit>，而检查脚本一路绿灯。
// 所以这里把出事那版代码原样喂给扫描器，要求它必须命中。
//
// 做法上有个坑：一开始这里用 child_process 起子进程跑检查脚本再读 stdout，
// 但沙箱禁止命名管道（stdio:'pipe' → EPERM），拿不到输出，
// "脚本失败"和"脚本正确报警"分不清，测试等于没做。
// 现在直接调用 tools/static-init-scan.js 这个纯函数，不碰子进程。
const fs = require('fs'), path = require('path');
const ROOT = ATL_ROOT;
const { scanStaticInitConfigReads } = require('./static-init-scan.js');

let bad = 0;
const ok = (m) => console.log('✅ ' + m);
const no = (m) => { console.log('❌ ' + m); bad++; };

// ------------------------------------------------------------------ 1. 真实事故代码
// 逐字抄自 2026-09-30 16:38 那次启动崩溃的 RodItem.java:330。
const CRASH_2026_09_30 = `
public final class RodItem {
    public record RodSpec(int maxDurability, double maxWeightKg) {
        /** 木竿：白绿档。 */
        public static final RodSpec WOOD = new RodSpec(2000, Tuning.rodWoodMaxWeightKg(), Tuning.rodWoodHookWindowBonus());
        /** 铁竿：到蓝档。 */
        public static final RodSpec IRON = new RodSpec(3500, Tuning.rodIronMaxWeightKg());
    }
}
`;
{
  const hits = scanStaticInitConfigReads(CRASH_2026_09_30);
  if (hits.length === 2 && hits[0].line === 5 && hits[1].line === 7) {
    ok('抓到 2026-09-30 那次启动崩溃的写法（' + hits.length + ' 处，行号准确）');
  } else no('没抓全出事那版：命中 ' + hits.length + ' 处（应 2） ' +
    JSON.stringify(hits.map((h) => h.line)));
}

// ------------------------------------------------------------------ 2. 静态块里读配置
{
  const src = `
class A {
    private static final Map<String, Double> TABLE = new HashMap<>();
    static {
        TABLE.put("a", Tuning.someValue());
        TABLE.put("b", 1.0);
    }
}
`;
  const hits = scanStaticInitConfigReads(src);
  if (hits.length === 1 && hits[0].line === 5) ok('抓到 static{} 块里的取配置');
  else no('static{} 块漏检：' + JSON.stringify(hits));
}

// ------------------------------------------------------------------ 3. 跨行声明（真按 Java 惯例换行写）
// 只看单行会漏掉这种；扫描器必须跟踪到语句的 `;`。
{
  const src = `
class B {
    public static final RodSpec WOOD = new RodSpec(
            2000,
            Tuning.rodWoodMaxWeightKg(),
            Tuning.rodWoodHookWindowBonus());
    private static final int OK = 1;
}
`;
  const hits = scanStaticInitConfigReads(src);
  if (hits.length === 2 && hits[0].line === 5 && hits[1].line === 6) {
    ok('跨行的静态声明也能抓到（2 处）');
  } else no('跨行声明漏检：' + JSON.stringify(hits));
}

// ------------------------------------------------------------------ 4. 不能误报
// 方法体里读配置是**完全正常**的（RodSpec 现在就是这么写的）。
// 误报会让这条检查变成噪音，然后被人关掉 —— 那还不如没有。
{
  const src = `
public final class RodItem {
    public static final class RodSpec {
        public static final RodSpec WOOD = new RodSpec(Material.WOOD);
        private final Material material;
        private RodSpec(Material m) { this.material = m; }
        public double maxWeightKg() {
            return switch (material) {
                case WOOD -> Tuning.rodWoodMaxWeightKg();
                case IRON -> Tuning.rodIronMaxWeightKg();
            };
        }
    }
}
`;
  const hits = scanStaticInitConfigReads(src);
  if (hits.length === 0) ok('不误报：修好之后的写法（常量只存材质 + 方法里现查）干净');
  else no('误报了正常代码：' + JSON.stringify(hits));
}

// ------------------------------------------------------------------ 5. 真源码必须干净
{
  const P = path.join(ROOT, 'src/main/java/com/whitecobalt/anglertackle/item/RodItem.java');
  const hits = scanStaticInitConfigReads(fs.readFileSync(P, 'utf8'));
  if (hits.length === 0) ok('当前 RodItem.java 的静态初始化干净');
  else no('当前 RodItem.java 静态初始化里还有取配置：' + JSON.stringify(hits));

  const src = fs.readFileSync(P, 'utf8');
  if (/private RodSpec\(Material material\)/.test(src) && !/RodSpec\(2000,/.test(src)) {
    ok('RodSpec 的构造器只收材质（数值没被烘进字段）');
  } else no('RodSpec 的构造器签名看着还是老样子');
}

console.log(bad === 0 ? '\n✅ 静态初始化检查有效（对坏代码报警 / 对好代码沉默）'
                      : '\n❌ 有 ' + bad + ' 处问题');
process.exit(bad ? 1 : 0);
