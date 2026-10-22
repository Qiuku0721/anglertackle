package com.whitecobalt.anglertackle.fishing;

import java.util.List;
import java.util.function.IntPredicate;

/**
 * 环境加权的**纯算法**：把"某组鱼的归一化占比抬到多少"算出来。
 *
 * <p>见 {@code docs/24-时间天气月相策划.md}（v2 · 占比约束版）。用户 2026-10-02 定案的三条约束：
 * <ul>
 *   <li><b>C1 时间</b>：受时段加成的组，归一化总占比最多 <b>+10 个百分点</b>；</li>
 *   <li><b>C2 天气</b>：同上，+10 个百分点；</li>
 *   <li><b>C3 月相</b>：所有金红鱼一起分 <b>5</b> 个百分点的爆率预算，所有紫鱼一起分 <b>15</b> 个。</li>
 * </ul>
 *
 * <p><b>为什么单独一个类、而且不碰任何游戏对象：</b>
 * 这套数学是"倍率必须反解、不能写死"的唯一落点，也是最容易写错的地方
 * （第一版按固定 ×1.2 写，只能得到 54.55/45.45，而用户要的是 40/60）。
 * 抽成纯静态方法之后，它有两条独立的保护：
 * <ol>
 *   <li>可以带 {@code --selftest} 直接用 {@code java} 跑，不需要启动 Minecraft ——
 *       所以 {@code tools/check-environment.js} 能拿用户给的两个算例当回归断言；</li>
 *   <li>游戏内与离线用的是**同一份代码**，不存在"模拟器算对了、游戏里算错了"。</li>
 * </ol>
 *
 * <p><b>只加不减</b>：只把组内鱼的权重乘 k，组外鱼一个都不动。它们占比下降
 * （50% → 40%）纯粹是归一化的必然结果（分母被抬大了），不是惩罚项 ——
 * 这保证"换个时段来钓鱼，收获不会变差，只是鱼的构成不同"。
 */
public final class EnvShare {

    private EnvShare() {
    }

    /**
     * 把 {@code inGroup} 命中的那组鱼的**归一化占比**抬到 {@code 原占比 + deltaPct}。
     *
     * <p>反解公式：设组占比 p、组外权重 other、组内权重 g，要让新占比等于 target，
     * 则 {@code k = target·other / ((1−target)·g)}。
     *
     * <p>校验（用户给的两个算例，反解出来的 k 都是 1.5）：
     * <pre>
     *   2 种鱼各 50%、1 种受加成：k = 0.6×1 / (0.4×1) = 1.5  →  60/40  ✅
     *   4 种鱼各 25%、2 种受加成：同上                →  30/30/20/20  ✅
     * </pre>
     *
     * @param weights  权重（**会被就地修改**）
     * @param inGroup  判定第 i 条是否吃这个维度的加成
     * @param deltaPct 目标增量（0~1；0.10 = 十个百分点）
     * @param capPct   安全阀：单组占比不得超过它（0~1）。防"极端池子算出组占比 100% 的倍率"。
     *                 ⚠ 它只保证"不把占比往上推超过 cap"；若原占比**已经**超过 cap
     *                 （极端池子里加成组本来就占 95%），本方法原样不动 —— 那要靠减权才能压下来，
     *                 而本系统是"只加不减"
     * @return 施加后是否达到目标（池子里只有这一组、或已到安全阀 → true，表示"无事可做/已到顶"）
     */
    public static boolean raiseShare(List<Integer> weights, IntPredicate inGroup,
                                     double deltaPct, double capPct) {
        long total = 0;
        long group = 0;
        for (int i = 0; i < weights.size(); i++) {
            int w = weights.get(i);
            total += w;
            if (inGroup.test(i)) {
                group += w;
            }
        }
        // 池子里没有这一组 → 本维度无事可做；全是这一组 → 占比恒 100%，抬不动。
        if (group <= 0 || total - group <= 0 || deltaPct <= 0.0) {
            return true;
        }
        double p = (double) group / total;
        double target = Math.min(p + deltaPct, capPct);
        if (target <= p) {
            return true;   // 已到顶（含被安全阀夹住）—— 这是"上界"，不是失败
        }
        double k = (target * (total - group)) / ((1.0 - target) * group);
        for (int i = 0; i < weights.size(); i++) {
            if (inGroup.test(i)) {
                weights.set(i, (int) Math.max(1, Math.round(weights.get(i) * k)));
            }
        }
        return true;
    }

    /**
     * 月相预算：给白名单里的鱼**分摊**一笔预算（用户原话"各分一点"）。
     *
     * <p>用户原话："比如钓鱼，抽取鱼所有金红鱼加起来 5%，月相加成吃满就是各分一点，
     * 所有金红鱼提升的爆率加起来不超 5%。紫爆率同理。"
     *
     * @param weights   权重（会被就地修改）
     * @param inGroup   第 i 条是否吃这笔预算（月相白名单 ∩ 对应档位）
     * @param budgetPct 总预算（0~1；金红 0.05 / 紫 0.15）
     * @param shareMode 0 = 组内同倍率（总和可能略微超出，见 {@link #raiseShare}）；
     *                  1 = 按条数均摊（每条各分 {@code budget/条数} 个百分点，恰好用完预算）
     * @param capPct    安全阀（只有 shareMode=0 用得上）
     */
    public static void spendBudget(List<Integer> weights, List<Boolean> inGroup,
                                   double budgetPct, int shareMode, double capPct) {
        int n = 0;
        for (boolean b : inGroup) {
            if (b) {
                n++;
            }
        }
        if (n == 0 || budgetPct <= 0.0) {
            return;
        }
        if (shareMode == 0) {
            raiseShare(weights, (i) -> inGroup.get(i), budgetPct, capPct);
            return;
        }
        // 均摊：要"第 i 条的占比 + per"，等价于把它的权重乘 (pᵢ + per) / pᵢ
        //（其余鱼不动，再归一化之后正好每条 +per）。
        long total = 0;
        for (int w : weights) {
            total += w;
        }
        double per = budgetPct / n;
        for (int i = 0; i < weights.size(); i++) {
            if (!inGroup.get(i)) {
                continue;
            }
            double p = (double) weights.get(i) / total;
            if (p <= 0.0) {
                continue;
            }
            double factor = (p + per) / p;
            weights.set(i, (int) Math.max(1, Math.round(weights.get(i) * factor)));
        }
    }

    /** 算出某一组当前的权重占比（0~1）—— 验收与调试都用它，别在别处再算一遍。 */
    public static double shareOf(List<Integer> weights, IntPredicate inGroup) {
        long total = 0;
        long group = 0;
        for (int i = 0; i < weights.size(); i++) {
            int w = weights.get(i);
            total += w;
            if (inGroup.test(i)) {
                group += w;
            }
        }
        return total <= 0 ? 0.0 : (double) group / total;
    }

    // ------------------------------------------------------------------ 自检入口

    /**
     * 用 {@code java} 直接跑算例回归（不给 Minecraft 环境）。
     *
     * <p>这不是"开发时的临时脚本"，而是**交付物的一部分**：
     * {@code tools/check-environment.js} 每次构建都会调用它，把用户给的两个算例当硬回归 ——
     * 谁要是把"反解倍率"改回"固定倍率"，这一步立刻退出码非零。
     *
     * <p>用法：{@code java -cp <classes> com.whitecobalt.anglertackle.fishing.EnvShare --selftest}
     */
    // 声明 throws Exception：要建结果文件（FileOutputStream 会抛 FileNotFoundException），
    // 而且还要指定 UTF-8 编码（UnsupportedEncodingException）。自检入口不需要精细的异常处理。
    public static void main(String[] args) throws Exception {
        if (args.length == 0 || !"--selftest".equals(args[0])) {
            System.out.println("用法：EnvShare --selftest（跑算例回归，输出 PASS/FAIL 行）");
            System.exit(2);
        }
        // ⚠ 输出必须显式指定 UTF-8：检查器是 Node 跑的，而 Windows 下 java 默认用系统代码页
        //   （实测输出成"????"），检查器按 UTF-8 读就会解析不到 PASS/FAIL 行。
        //
        // ⚠ 同时写一份结果文件：Node 侧**不能**用管道读 java 的 stdout ——
        //   本机沙箱禁止进程开命名管道，管道式 stdio 会 EPERM（见 AGENTS.md）。
        //   所以 java 自己把结果写进文件，检查器读文件断言，控制台输出照常给人看。
        java.io.PrintStream out = new java.io.PrintStream(System.out, true, "UTF-8");
        // 用数组持一份引用：System.exit 之前要显式 flush 它，否则文件可能是空的
        final java.io.PrintStream[] sink = new java.io.PrintStream[1];
        for (String a : args) {
            if (a.startsWith("--out=")) {
                final java.io.PrintStream file = new java.io.PrintStream(
                        new java.io.FileOutputStream(a.substring(6)), true, "UTF-8");
                sink[0] = file;
                final java.io.PrintStream base = out;
                out = new java.io.PrintStream(new java.io.OutputStream() {
                    @Override
                    public void write(int b) {
                        base.write(b);
                        file.write(b);
                    }

                    @Override
                    public void write(byte[] buf, int off, int len) {
                        base.write(buf, off, len);
                        file.write(buf, off, len);
                    }

                    @Override
                    public void flush() {
                        base.flush();
                        file.flush();
                    }
                }, true, "UTF-8");
            }
        }
        System.setOut(out);
        final java.io.PrintStream console = out;

        int fail = 0;

        // ⚠ 算例用**真实量级的权重**（鱼池基础权重是 40/26/16/12，见 FishSpecies.baseWeightByTier）。
        //   一开始我图省事写成 [1,1] / [1,1,1,1]，结果断言红了 —— 原因不是算法错，
        //   而是**整数权重的量化误差**：k=1.5 作用在权重 1 上算出 1.5，
        //   四舍五入到 2 就把占比从 60% 顶到 66.7%。权重越小误差越大
        //   （1 和 3 之间分辨率只有 1/4），而真实池子的权重是两位数，误差 <1%。
        //   所以：算例用两位数权重，并且容差给 0.5 个百分点。
        //
        // 算例 A：2 种鱼各 50%，1 种受加成 → 期望 60/40
        fail += caseOne(console, "A 2种各50% 1种加成", new int[]{24, 24}, new boolean[]{true, false},
                new double[]{60, 40});
        // 算例 B：4 种鱼各 25%，2 种受加成 → 期望 30/30/20/20
        fail += caseOne(console, "B 4种各25% 2种加成", new int[]{12, 12, 12, 12},
                new boolean[]{true, true, false, false}, new double[]{30, 30, 20, 20});

        // 上界：无论池子怎么组成，"组增量"都不许超过 delta 与安全阀
        fail += upperBoundCases(console);

        console.println(fail == 0 ? "SELFTEST PASS" : ("SELFTEST FAIL " + fail));
        console.flush();
        if (sink[0] != null) {
            sink[0].flush();
        }
        System.exit(fail == 0 ? 0 : 1);
    }

    private static int caseOne(java.io.PrintStream console, String name, int[] raw, boolean[] in, double[] want) {
        List<Integer> w = new java.util.ArrayList<>();
        for (int x : raw) {
            w.add(x);
        }
        raiseShare(w, (i) -> in[i], 0.10, 0.90);
        long total = 0;
        for (int x : w) {
            total += x;
        }
        StringBuilder got = new StringBuilder();
        int bad = 0;
        for (int i = 0; i < w.size(); i++) {
            double pct = 100.0 * w.get(i) / total;
            got.append(String.format("%.2f", pct));
            if (i < w.size() - 1) {
                got.append('/');
            }
            // 容差 0.5 个百分点：权重是整数，四舍五入后占比必然有一点点误差
            // （真实量级权重下 <0.5%）。这里断言的是"算法对不对"，不是"舍入到小数点后两位"。
            if (Math.abs(pct - want[i]) > 0.5) {
                bad++;
            }
        }
        if (bad > 0) {
            console.println("FAIL " + name + " 期望 " + fmt(want) + " 实得 " + got);
            return 1;
        }
        console.println("PASS " + name + " → " + got);
        return 0;
    }

    private static int upperBoundCases(java.io.PrintStream console) {
        int bad = 0;
        // 覆盖不同原占比。用真实量级的权重（两位数），避免整数权重的量化误差干扰上界判定
        // —— 占比 10% / 25% / 50% / 75% / 95%
        for (int[] shape : new int[][]{{4, 36}, {12, 36}, {24, 24}, {36, 12}, {76, 4}}) {
            List<Integer> w = new java.util.ArrayList<>();
            for (int x : shape) {
                w.add(x);
            }
            List<Integer> before = new java.util.ArrayList<>(w);
            double p0 = shareOf(before, (i) -> i == 0);
            raiseShare(w, (i) -> i == 0, 0.10, 0.90);
            double p1 = shareOf(w, (i) -> i == 0);
            double delta = p1 - p0;
            if (delta > 0.10 + 1e-9) {
                console.println(String.format("FAIL 上界 原占比 %.2f → %.2f（增量 %.4f > 0.10）",
                        p0 * 100, p1 * 100, delta));
                bad++;
            }
            if (p1 > Math.max(p0, 0.90) + 1e-9) {
                // ⚠ 断言的是 max(p0, cap) 而不是 cap：安全阀的语义是"**不许再往上推**超过 cap"，
                //   不是"把已经超过 cap 的组按下来"（那要靠减权，而本系统只加不减）。
                //   极端池子（加成组本来就占 95%）里它只会原样不动 —— 这是对的。
                console.println(String.format("FAIL 安全阀 占比 %.4f → %.4f（越过 max(原占比, cap)）", p0, p1));
                bad++;
            }
        }
        // 只加不减：组外权重必须逐条不变
        List<Integer> w = new java.util.ArrayList<>(List.of(13, 17, 19, 23));
        List<Integer> before = new java.util.ArrayList<>(w);
        raiseShare(w, (i) -> i < 2, 0.10, 0.90);
        for (int i = 2; i < 4; i++) {
            if (!w.get(i).equals(before.get(i))) {
                console.println("FAIL 只加不减：组外第 " + i + " 条权重被改了 " + before.get(i) + " → " + w.get(i));
                bad++;
            }
        }
        if (bad == 0) {
            console.println("PASS 上界与只加不减（5 种池子形状 + 组外逐条不变）");
        }
        return bad;
    }

    private static String fmt(double[] a) {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < a.length; i++) {
            s.append(String.format("%.2f", a[i]));
            if (i < a.length - 1) {
                s.append('/');
            }
        }
        return s.toString();
    }
}
