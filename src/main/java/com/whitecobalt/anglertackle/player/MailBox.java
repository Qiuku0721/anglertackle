package com.whitecobalt.anglertackle.player;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 玩家的**邮箱**（用户 2026-10-11 点名要的邮件系统，策划见 `docs/36`）。
 *
 * <h2>为什么单开一个附件，不塞进 {@link PlayerFishingData}</h2>
 * 与 {@code docs/36} §2.1 记的同一条理由：那个 record 的构造点太多，而邮件是**不断增删的表**，
 * 每加一个字段都要全改一遍构造点；单开附件之后老存档读进来就是 {@code EMPTY}（**零迁移** ✓），
 * 且 `copyOnDeath` ⇒ 死一次不会把邮件清空 ✓。
 *
 * <h2>⚠ 不存"未读数"</h2>
 * 未读与待领都是**从列表数出来的派生值**（{@link #unread()} / {@link #claimable()}）。
 * 单独存一个计数器迟早和真实状态不一致 —— 本仓库"两套刻度"那两次事故就是同一类：
 * 两个真源、不崩不报错、只是数不对 ✗。
 *
 * @param mails  按**收到时间倒序**（最新在最上面；界面直接照序画）
 * @param nextId 递增序号（邮件 id = 收件人自己的序号，够用且短）
 */
public record MailBox(List<MailEntry> mails, int nextId) {

    public static final MailBox EMPTY = new MailBox(List.of(), 1);

    public static final Codec<MailBox> CODEC = RecordCodecBuilder.create(inst -> inst.group(
            // ⚠ 一律 optionalFieldOf：老存档里根本没有这个键，用 fieldOf 会让整份数据读不进来
            MailEntry.CODEC.listOf().optionalFieldOf("mails", List.of()).forGetter(MailBox::mails),
            Codec.INT.optionalFieldOf("next_id", 1).forGetter(MailBox::nextId)
    ).apply(inst, MailBox::new));

    /** 未读封数（**派生值**，不存）。 */
    public int unread() {
        int n = 0;
        for (MailEntry m : mails) {
            if (m.unread()) {
                n++;
            }
        }
        return n;
    }

    /** 待领封数（**派生值**，不存）。 */
    public int claimable() {
        int n = 0;
        for (MailEntry m : mails) {
            if (m.claimable()) {
                n++;
            }
        }
        return n;
    }

    /** 按 id 找一封（找不到返回 null）。 */
    public MailEntry byId(int id) {
        for (MailEntry m : mails) {
            if (m.id() == id) {
                return m;
            }
        }
        return null;
    }

    /** 回执用的副本：新邮件放在**最前面**（列表最新在上）。 */
    public MailBox withAdded(MailEntry entry) {
        List<MailEntry> next = new ArrayList<>(mails.size() + 1);
        next.add(entry);
        next.addAll(mails);
        return new MailBox(List.copyOf(next), Math.max(nextId, entry.id() + 1));
    }

    /** 用新的同一封替换旧的（按 id 匹配）；找不到就原样返回。 */
    public MailBox withReplaced(MailEntry entry) {
        List<MailEntry> next = new ArrayList<>(mails.size());
        boolean hit = false;
        for (MailEntry m : mails) {
            if (m.id() == entry.id()) {
                next.add(entry);
                hit = true;
            } else {
                next.add(m);
            }
        }
        return hit ? new MailBox(List.copyOf(next), nextId) : this;
    }

    /** 把所有邮件标记已读（第一版界面上的"全部已读"）。 */
    public MailBox withAllRead() {
        if (unread() == 0) {
            return this;
        }
        List<MailEntry> next = new ArrayList<>(mails.size());
        for (MailEntry m : mails) {
            next.add(m.withRead());
        }
        return new MailBox(List.copyOf(next), nextId);
    }

    /**
     * 新手礼包那封**还没领**时，把它标成未读。
     *
     * <p>为什么需要：礼包是走邮件发的（{@link com.whitecobalt.anglertackle.mail.MailService#deliver}），
     * 而它是**附件信、初始 read=false** —— 但玩家可能在那一瞬间正看着别处，
     * 登录那一下的未读提示就过去了。标成未读之后，{@link #unread()} 会把它算进去，
     * 于是每次登录的未读提示都会再提一次，直到他点开领走为止 ✓。
     *
     * <p>⚠ 只在**还没领**时改：领过的信再标未读，就成了永远消不掉的"未读" ✗。
     * 判据用模板 id + 空参数（与 {@code MailService.KIT} 那封的构造逐字一致）。
     */
    public MailBox withKitUnread() {
        List<MailEntry> next = new ArrayList<>(mails.size());
        boolean changed = false;
        for (MailEntry m : mails) {
            // ⚠ 条件是"**已经读过**且还没领"才需要改回未读；本来就未读的 (`m.unread()`)
            //   原样放回去即可 —— 第一版把这两个分支写反了，`withUnread()` 永远命中不到，
            //   方法退化成"原样返回"（而它还编译得过）。
            if ("starter_kit".equals(m.template()) && !m.claimed() && !m.unread()) {
                changed = true;
                next.add(m.withUnread());
            } else {
                next.add(m);
            }
        }
        return changed ? new MailBox(List.copyOf(next), nextId) : this;
    }

    /** 把每封邮件都过一遍 {@code fn}（过期作废附件走它）。 */
    public MailBox mapAll(java.util.function.UnaryOperator<MailEntry> fn) {
        List<MailEntry> next = new ArrayList<>(mails.size());
        boolean changed = false;
        for (MailEntry m : mails) {
            MailEntry r = fn.apply(m);
            next.add(r);
            if (r != m) {
                changed = true;
            }
        }
        return changed ? new MailBox(List.copyOf(next), nextId) : this;
    }

    /** 按收到时间倒序排一份（磁盘上的顺序理论上已经是对的，这里防手改/防老存档顺序错乱）。 */
    public List<MailEntry> sorted() {
        List<MailEntry> copy = new ArrayList<>(mails);
        copy.sort(Comparator.comparingLong(MailEntry::sentAt).reversed());
        return List.copyOf(copy);
    }
}
