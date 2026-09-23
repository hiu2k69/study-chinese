
        const LEVEL_DEFAULTS = {
            quizOptionCount: 4
        };
        const LEVELS = [
            { id: 1, label: 'HSK 1', file: 'data/hsk1.json' },
            { id: 2, label: 'HSK 2', file: 'data/hsk2.json' },
            { id: 3, label: 'HSK 3', file: 'data/hsk3.json' },
            { id: 4, label: 'HSK 4', file: 'data/hsk4.json' },
            { id: 5, label: 'HSK 5', file: 'data/hsk5.json' },
            { id: 6, label: 'HSK 6', file: 'data/hsk6.json' },
            { id: 30, label: 'HSK 3.0', file: 'data/hsk30.json' },
            { id: 40, label: 'OTHERS', file: 'data/others.json' },
        ].map(lv => ({ ...LEVEL_DEFAULTS, ...lv }));
        const MODES = [
            {
                id: 'flash',
                label: '🃏 Thẻ ghi nhớ',
                render: () => renderFlash(),
                shuffle: () => { resetOrder(); renderFlash(); popAnimate(document.getElementById('flash-card'), 'animate__flip'); toast('Đã xáo trộn!'); }
            },
            {
                id: 'quiz',
                label: '✅ Trắc nghiệm',
                render: () => renderQuiz(),
                shuffle: () => { resetOrder(); renderQuiz(); toast('Đã xáo trộn!'); }
            },
            {
                id: 'type',
                label: '⌨️ Gõ Pinyin',
                render: () => renderType(),
                shuffle: () => { resetOrder(); renderType(); toast('Đã xáo trộn!'); }
            },
            // Thêm chế độ mới ở đây, ví dụ:
            // { id: 'listen', label: '🔊 Nghe đoán từ', render: () => renderListen(), shuffle: () => {...} },
        ];

        function getLevelConfig(id) {
            return LEVELS.find(l => l.id === id);
        }
        function getModeConfig(id) {
            return MODES.find(m => m.id === id);
        }

        // ===== STATE =====
        const VOCAB_BY_LEVEL = {};
        let currentLevel = LEVELS[0].id;
        let VOCAB = [];
        let mode = MODES[0].id;
        let order = [];
        let idx = 0;
        let done = 0, correct = 0;
        let answered = false;
        let consecutiveCorrect = 0;
        let advanceTimer = null;
        // Nhật ký các câu đã trả lời trong VÒNG HIỆN TẠI (reset mỗi khi resetOrder()
        // được gọi — tức đổi cấp độ / xáo trộn / bắt đầu vòng mới). Dùng để biết
        // khi nào đã làm hết toàn bộ số từ và để hiển thị modal tổng kết.
        let roundLog = [];

        // ===== RIPPLE EFFECT (áp dụng cho mọi .btn / .level-btn / .mode-btn / .tone-btn) =====
        function attachRipple(el) {
            el.addEventListener('click', function (e) {
                const rect = this.getBoundingClientRect();
                const ripple = document.createElement('span');
                const size = Math.max(rect.width, rect.height);
                ripple.className = 'ripple';
                ripple.style.width = ripple.style.height = size + 'px';
                ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
                ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
                this.style.position = this.style.position || 'relative';
                this.style.overflow = 'hidden';
                this.appendChild(ripple);
                setTimeout(() => ripple.remove(), 600);
            });
        }
        function attachRippleAll() {
            document.querySelectorAll('.btn, .level-btn, .mode-btn, .tone-btn').forEach(attachRipple);
        }

        // ===== small animation helper (animate.css) =====
        // Có cơ chế fallback timeout để đảm bảo class + opacity luôn được dọn
        // sạch, tránh trường hợp animationend không bắn (bấm nhanh liên tục,
        // tab mất focus, v.v...) khiến chữ bị kẹt ở trạng thái mờ giữa chừng.
        function popAnimate(el, cls) {
            if (!el) return;
            if (el._animCleanup) el._animCleanup();
            el.classList.remove('animate__animated', cls);
            void el.offsetWidth; // force reflow để restart animation
            el.classList.add('animate__animated', cls);

            const cleanup = () => {
                el.classList.remove('animate__animated', cls);
                el.style.opacity = '';
                el.removeEventListener('animationend', onEnd);
                clearTimeout(fallback);
                el._animCleanup = null;
            };
            const onEnd = () => cleanup();
            el.addEventListener('animationend', onEnd);
            const fallback = setTimeout(cleanup, 900);
            el._animCleanup = cleanup;
        }

        function pulseStat(id) {
            const el = document.getElementById(id);
            el.classList.remove('pulse');
            void el.offsetWidth;
            el.classList.add('pulse');
        }

        // ===== LOADING OVERLAY (dùng counter để chịu được nhiều lệnh tải chồng nhau,
        // ví dụ tìm kiếm tải nhiều file JSON cùng lúc với việc đổi cấp độ) =====
        const loadOverlay = document.getElementById('load-overlay');
        let loadingCount = 0;
        function showLoading(text) {
            loadingCount++;
            document.getElementById('load-text').textContent = text || 'Đang tải từ vựng...';
            loadOverlay.classList.add('show');
        }
        function hideLoading() {
            loadingCount = Math.max(0, loadingCount - 1);
            if (loadingCount === 0) loadOverlay.classList.remove('show');
        }

        // ===== AUDIO =====
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        function playTone(freq, type, duration, vol = 0.12) {
            try {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = type;
                osc.frequency.value = freq;
                gain.gain.value = vol;
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
                osc.stop(audioCtx.currentTime + duration);
            } catch (e) { }
        }
        function playCorrect() {
            playTone(880, 'sine', 0.1);
            setTimeout(() => playTone(1175, 'sine', 0.15), 70);
        }
        function playWrong() {
            playTone(200, 'sawtooth', 0.2, 0.08);
        }

        // ===== FIREWORKS =====
        const canvas = document.getElementById('fw-canvas');
        const ctx = canvas.getContext('2d', { alpha: true });
        let particles = [];
        let rockets = [];
        let fwRunning = false;
        let animId = null;

        const colors = ['#ff4d6d', '#00d4ff', '#7b2cbf', '#00e676', '#ffd700', '#ff6b35', '#a855f7'];
        const MAX_PARTICLES = 280;
        const PARTICLE_POOL = [];
        const ROCKET_POOL = [];

        for (let i = 0; i < MAX_PARTICLES; i++) {
            PARTICLE_POOL.push({
                x: 0, y: 0, vx: 0, vy: 0,
                color: '#fff', alpha: 0, life: 0,
                size: 2, gravity: 0.09, friction: 0.96,
                active: false
            });
        }
        for (let i = 0; i < 12; i++) {
            ROCKET_POOL.push({
                x: 0, y: 0, targetY: 0, speed: 0,
                color: '#fff', trail: [], active: false
            });
        }

        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        function getParticle() {
            for (let i = 0; i < PARTICLE_POOL.length; i++) {
                if (!PARTICLE_POOL[i].active) return PARTICLE_POOL[i];
            }
            return null;
        }

        function getRocket() {
            for (let i = 0; i < ROCKET_POOL.length; i++) {
                if (!ROCKET_POOL[i].active) return ROCKET_POOL[i];
            }
            return null;
        }

        function spawnExplosion(x, y, baseColor) {
            const count = 42;
            for (let i = 0; i < count; i++) {
                const p = getParticle();
                if (!p) break;
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 5.5 + 1.8;
                p.x = x; p.y = y;
                p.vx = Math.cos(angle) * speed;
                p.vy = Math.sin(angle) * speed;
                p.color = Math.random() > 0.28 ? baseColor : colors[(Math.random() * colors.length) | 0];
                p.alpha = 1;
                p.life = 38 + (Math.random() * 28) | 0;
                p.active = true;
                p.size = 1.6 + Math.random() * 2.4;
                particles.push(p);
            }
        }

        function triggerFireworks() {
            canvas.classList.add('active');
            const toLaunch = Math.min(4, 12 - rockets.length);
            for (let i = 0; i < toLaunch; i++) {
                setTimeout(() => {
                    const r = getRocket();
                    if (!r) return;
                    r.x = Math.random() * canvas.width * 0.7 + canvas.width * 0.15;
                    r.y = canvas.height;
                    r.targetY = 70 + Math.random() * canvas.height * 0.38;
                    r.speed = 7.2 + Math.random() * 2.8;
                    r.color = colors[(Math.random() * colors.length) | 0];
                    r.trail.length = 0;
                    r.active = true;
                    rockets.push(r);
                }, i * 180);
            }
            if (!fwRunning) {
                fwRunning = true;
                animId = requestAnimationFrame(animateFW);
            }
        }

        function animateFW() {
            if (particles.length || rockets.length) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }

            for (let i = rockets.length - 1; i >= 0; i--) {
                const r = rockets[i];
                r.y -= r.speed;
                r.trail.push(r.x, r.y);
                if (r.trail.length > 16) r.trail.splice(0, 2);

                for (let t = 0; t < r.trail.length; t += 2) {
                    ctx.globalAlpha = (t / r.trail.length) * 0.45;
                    ctx.fillStyle = r.color;
                    ctx.fillRect(r.trail[t] - 1.2, r.trail[t + 1] - 1.2, 2.4, 2.4);
                }

                ctx.globalAlpha = 1;
                ctx.fillStyle = '#fff';
                ctx.fillRect(r.x - 2, r.y - 2, 4, 4);

                if (r.y <= r.targetY) {
                    spawnExplosion(r.x, r.y, r.color);
                    r.active = false;
                    rockets.splice(i, 1);
                }
            }

            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.vx *= p.friction;
                p.vy = p.vy * p.friction + p.gravity;
                p.x += p.vx;
                p.y += p.vy;
                p.alpha -= 1 / p.life;
                p.life--;

                if (p.life <= 0 || p.alpha <= 0.02 || p.y > canvas.height + 40) {
                    p.active = false;
                    particles.splice(i, 1);
                    continue;
                }

                ctx.globalAlpha = p.alpha;
                ctx.fillStyle = p.color;
                const s = p.size;
                ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
            }

            ctx.globalAlpha = 1;

            if (particles.length > 0 || rockets.length > 0) {
                animId = requestAnimationFrame(animateFW);
            } else {
                canvas.classList.remove('active');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                fwRunning = false;
                animId = null;
            }
        }

        // ===== UTILS =====
        function shuffle(a) {
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        }
        function clearAdvance() {
            if (advanceTimer) {
                clearTimeout(advanceTimer);
                advanceTimer = null;
            }
        }
        function resetOrder() {
            order = shuffle([...Array(VOCAB.length).keys()]);
            idx = 0;
            answered = false;
            roundLog = [];
            clearAdvance();
        }
        function toast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.classList.add('show');
            clearTimeout(toast._t);
            toast._t = setTimeout(() => t.classList.remove('show'), 2000);
        }
        function updateStats() {
            document.getElementById('stat-done').textContent = done;
            document.getElementById('stat-correct').textContent = correct;
            document.getElementById('stat-acc').textContent = done ? Math.round(correct / done * 100) + '%' : '—';
            pulseStat('stat-done');
            pulseStat('stat-correct');
            pulseStat('stat-acc');
        }
        function updateProgress(id) {
            document.getElementById(id).style.width = (roundLog.length / order.length * 100).toFixed(1) + '%';
        }
        function normalizePinyin(s) {
            return s.toLowerCase()
                .replace(/[āáǎà]/g, 'a').replace(/[ēéěè]/g, 'e')
                .replace(/[īíǐì]/g, 'i').replace(/[ōóǒò]/g, 'o')
                .replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜü]/g, 'v')
                .replace(/[1-5]/g, '').replace(/\s+/g, '').trim();
        }
        function checkAndCelebrate(isCorrect) {
            if (isCorrect) {
                consecutiveCorrect++;
                if (consecutiveCorrect % 5 === 0) {
                    triggerFireworks();
                    toast('🎉 Đúng ' + consecutiveCorrect + ' câu liên tiếp!');
                }
            } else {
                consecutiveCorrect = 0;
            }
        }

        // ===== NHẬT KÝ VÒNG HỌC + MODAL TỔNG KẾT =====
        // Ghi lại 1 câu đã trả lời (đúng hoặc sai) vào vòng hiện tại. Được gọi
        // từ cả 3 chế độ: Trắc nghiệm, Gõ Pinyin, và 2 nút "Đã thuộc/Chưa thuộc"
        // ở Thẻ ghi nhớ. Khi số câu đã ghi == tổng số từ của cấp độ đang học,
        // vòng học coi như hoàn thành và modal tổng kết sẽ được hiện ra.
        function recordAnswer(item, isCorrect) {
            roundLog.push({ h: item.h, p: item.p, m: item.m, correct: isCorrect });
        }
        function isRoundComplete() {
            return order.length > 0 && roundLog.length >= order.length;
        }
        function evalMessage(pct) {
            if (pct === 100) return 'FULL COMBO! HSK nhìn bạn cũng phải cúi đầu! 🗿🏆';
            if (pct >= 80) return 'Khét đấy! Có vẻ hôm nay bạn không học bằng niềm tin! 🔥😎';
            if (pct >= 60) return 'Tạm ổn! Não vẫn còn kết nối Wi-Fi với tiếng Trung! 📶😂';
            if (pct >= 40) return 'Toang nhẹ! Từ vựng chạy nhanh hơn tốc độ bạn học! 🏃💨';
            return 'Học kiểu này HSK cũng phải hỏi: “Bạn là ai?” 🤡📚';
        }
        function summaryRow(w) {
            return `<div class="summary-row ${w.correct ? 'ok' : 'bad'}">
                <span class="summary-hanzi">${escapeHtml(w.h)}</span>
                <span class="summary-pinyin">${escapeHtml(w.p)}</span>
                <span class="summary-meaning">${escapeHtml(w.m)}</span>
            </div>`;
        }
        function showRoundSummary() {
            clearAdvance();
            const total = roundLog.length;
            const correctCount = roundLog.filter(x => x.correct).length;
            const wrongList = roundLog.filter(x => !x.correct);
            const pct = total ? Math.round(correctCount / total * 100) : 0;

            document.getElementById('summary-score').textContent = pct + '%';
            document.getElementById('summary-detail').textContent = `Đúng ${correctCount}/${total} · ${getLevelName(currentLevel)}`;
            document.getElementById('summary-eval').textContent = evalMessage(pct);

            document.getElementById('summary-wrong-list').innerHTML = wrongList.length
                ? wrongList.map(summaryRow).join('')
                : '<div class="summary-empty">Không sai câu nào cả 🎉</div>';

            const modal = document.getElementById('summary-modal');
            modal.classList.add('show');
            if (pct >= 80) triggerFireworks();
        }
        function closeRoundSummary(restart) {
            document.getElementById('summary-modal').classList.remove('show');
            resetOrder();
            if (mode === 'flash') renderFlash();
            else if (mode === 'quiz') renderQuiz();
            else renderType();
            if (restart) toast('Bắt đầu vòng mới!');
        }
        document.getElementById('summary-restart').onclick = () => closeRoundSummary(true);
        document.getElementById('summary-close').onclick = () => closeRoundSummary(false);

        // ===== LOAD VOCAB FROM JSON =====
        async function loadVocab(level) {
            const cfg = getLevelConfig(level);
            const url = cfg && cfg.file;
            if (!url) return [];

            showLoading('Đang tải ' + getLevelName(level) + '...');
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error('Không tải được file');
                const data = await res.json();
                VOCAB_BY_LEVEL[level] = data;
                return data;
            } catch (err) {
                console.error('Lỗi load vocab:', err);
                toast('Không tải được từ vựng cấp này');
                return [];
            } finally {
                hideLoading();
            }
        }

        function getLevelName(level) {
            const cfg = getLevelConfig(level);
            return cfg ? cfg.label : `HSK ${level}`;
        }

        async function setLevel(level) {
            currentLevel = level;

            if (!VOCAB_BY_LEVEL[level]) {
                VOCAB = await loadVocab(level);
            } else {
                VOCAB = VOCAB_BY_LEVEL[level];
            }

            localStorage.setItem('hsk_last_level', level);

            document.querySelectorAll('.level-btn').forEach(b => {
                b.classList.toggle('active', +b.dataset.level === level);
            });

            done = 0;
            correct = 0;
            consecutiveCorrect = 0;
            updateStats();
            document.getElementById('stat-total').textContent = VOCAB.length;

            const desc = document.getElementById('header-desc');
            desc.style.opacity = 0;
            setTimeout(() => {
                desc.textContent = `${getLevelName(level)} · ${VOCAB.length} từ · Nghĩa tiếng Việt · Thẻ ghi nhớ · Trắc nghiệm · Gõ Pinyin`;
                desc.style.opacity = 1;
            }, 150);

            resetOrder();

            popAnimate(document.getElementById('panel-' + mode), 'animate__fadeIn');

            if (mode === 'flash') renderFlash();
            else if (mode === 'quiz') renderQuiz();
            else renderType();

            toast(`Đã chuyển sang ${getLevelName(level)}`);
        }

        // ===== FLASH =====
        function renderFlash() {
            if (!VOCAB.length) return;
            const w = VOCAB[order[idx]];
            const cardEl = document.getElementById('flash-card');
            cardEl.classList.remove('flipped');
            document.getElementById('flash-hanzi').textContent = w.h;
            document.getElementById('flash-pinyin').textContent = w.p;
            document.getElementById('flash-meaning').textContent = w.m;
            popAnimate(document.getElementById('flash-hanzi'), 'animate__fadeIn');
            updateProgress('flash-progress');
        }
        document.getElementById('flash-card').onclick = () => {
            document.getElementById('flash-card').classList.toggle('flipped');
        };
        // "Tiếp / Trước" dùng để DUYỆT tự do, không tính điểm / không ghi vào
        // roundLog — tránh ép người dùng phải chấm điểm nếu chỉ muốn lướt xem.
        document.getElementById('flash-next').onclick = () => {
            if (!VOCAB.length) return;
            idx = (idx + 1) % order.length;
            renderFlash();
        };
        document.getElementById('flash-prev').onclick = () => {
            if (!VOCAB.length) return;
            idx = (idx - 1 + order.length) % order.length;
            renderFlash();
        };
        // 2 nút chấm điểm: ghi vào roundLog + tự động sang thẻ tiếp theo (hoặc
        // hiện modal tổng kết nếu đây là thẻ cuối cùng của vòng).
        function flashRateAndAdvance(isCorrect) {
            if (!VOCAB.length) return;
            const w = VOCAB[order[idx]];
            recordAnswer(w, isCorrect);
            done++;
            if (isCorrect) correct++;
            updateStats();
            checkAndCelebrate(isCorrect);
            updateProgress('flash-progress');
            if (isRoundComplete()) {
                showRoundSummary();
                return;
            }
            idx = (idx + 1) % order.length;
            renderFlash();
        }
        document.getElementById('flash-know').onclick = () => flashRateAndAdvance(true);
        document.getElementById('flash-dontknow').onclick = () => flashRateAndAdvance(false);
        // (nút flash-shuffle được gắn tập trung qua bindShuffleButtons() + MODES)

        // ===== QUIZ =====
        function advanceQuiz() {
            clearAdvance();
            if (isRoundComplete()) {
                showRoundSummary();
                return;
            }
            idx = (idx + 1) % order.length;
            renderQuiz();
        }
        function renderQuiz() {
            if (!VOCAB.length) return;
            clearAdvance();
            answered = false;
            const w = VOCAB[order[idx]];
            document.getElementById('quiz-hanzi').textContent = w.h;
            document.getElementById('quiz-hint').textContent = '';
            document.getElementById('quiz-hint').classList.remove('show');
            document.getElementById('quiz-next').style.display = 'none';
            popAnimate(document.querySelector('.quiz-question'), 'animate__fadeIn');

            let opts = [w.m];
            while (opts.length < 4) {
                const r = VOCAB[Math.floor(Math.random() * VOCAB.length)].m;
                if (!opts.includes(r)) opts.push(r);
            }
            opts = shuffle(opts);

            const box = document.getElementById('quiz-options');
            box.innerHTML = '';
            opts.forEach((o, i) => {
                const btn = document.createElement('button');
                btn.className = 'option';
                btn.style.animationDelay = (i * 0.06) + 's';
                btn.textContent = o;
                btn.onclick = (e) => {
                    if (answered) return;
                    answered = true;
                    done++;
                    const isCorrect = o === w.m;
                    if (isCorrect) { correct++; playCorrect(); } else playWrong();
                    recordAnswer(w, isCorrect);
                    checkAndCelebrate(isCorrect);
                    updateStats();
                    document.querySelectorAll('.option').forEach(b => {
                        b.classList.add('disabled');
                        if (b.textContent === w.m) b.classList.add('correct');
                    });
                    if (!isCorrect) btn.classList.add('wrong');
                    document.getElementById('quiz-hint').textContent = w.p;
                    document.getElementById('quiz-hint').classList.add('show');

                    if (isCorrect) {
                        advanceTimer = setTimeout(advanceQuiz, 350);
                    } else {
                        document.getElementById('quiz-next').style.display = 'inline-block';
                        popAnimate(document.getElementById('quiz-next'), 'animate__fadeInUp');
                    }
                };
                attachRipple(btn);
                box.appendChild(btn);
            });
            updateProgress('quiz-progress');
        }
        document.getElementById('quiz-next').onclick = () => advanceQuiz();
        // (nút quiz-shuffle được gắn tập trung qua bindShuffleButtons() + MODES)

        // ===== TYPE =====
        function advanceType() {
            clearAdvance();
            if (isRoundComplete()) {
                showRoundSummary();
                return;
            }
            idx = (idx + 1) % order.length;
            renderType();
        }
        function renderType() {
            if (!VOCAB.length) return;
            clearAdvance();
            answered = false;
            const w = VOCAB[order[idx]];
            document.getElementById('type-hanzi').textContent = w.h;
            document.getElementById('type-meaning').textContent = w.m;
            popAnimate(document.querySelector('.type-question'), 'animate__fadeIn');
            const input = document.getElementById('pinyin-input');
            input.value = '';
            input.classList.remove('correct', 'wrong');
            input.disabled = false;
            input.focus();
            document.getElementById('type-feedback').textContent = '';
            document.getElementById('type-feedback').className = 'feedback';
            updateProgress('type-progress');
        }
        function checkPinyin() {
            if (answered) return;
            const w = VOCAB[order[idx]];
            const input = document.getElementById('pinyin-input');
            const user = input.value.trim();
            if (!user) return;
            answered = true;
            done++;
            const isCorrect = normalizePinyin(user) === normalizePinyin(w.p);
            recordAnswer(w, isCorrect);
            if (isCorrect) {
                correct++;
                input.classList.add('correct');
                input.disabled = true;
                document.getElementById('type-feedback').textContent = '✓ Chính xác! ' + w.p;
                document.getElementById('type-feedback').className = 'feedback ok';
                playCorrect();
                checkAndCelebrate(true);
                advanceTimer = setTimeout(advanceType, 350);
            } else {
                input.classList.add('wrong');
                document.getElementById('type-feedback').textContent = '✗ Đáp án: ' + w.p;
                document.getElementById('type-feedback').className = 'feedback err';
                playWrong();
                checkAndCelebrate(false);
            }
            updateStats();
        }
        document.getElementById('type-check').onclick = checkPinyin;
        document.getElementById('pinyin-input').onkeydown = e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!answered) checkPinyin();
            else advanceType();
        };
        document.getElementById('type-skip').onclick = () => {
            // Bỏ qua mà chưa trả lời cũng được tính là 1 câu sai để vòng học
            // vẫn hoàn thành đúng khi đi hết danh sách từ.
            if (!answered && VOCAB.length) {
                const w = VOCAB[order[idx]];
                recordAnswer(w, false);
                done++;
                checkAndCelebrate(false);
                updateStats();
            }
            advanceType();
        };
        // (nút type-shuffle được gắn tập trung qua bindShuffleButtons() + MODES)
        document.querySelectorAll('.tone-btn').forEach(btn => {
            btn.onclick = () => {
                const input = document.getElementById('pinyin-input');
                if (input.disabled) return;
                if (btn.dataset.tone !== '0') input.value += btn.dataset.tone;
                input.focus();
            };
        });

        // ===== MODE =====
        function switchMode(modeId) {
            const cfg = getModeConfig(modeId);
            if (!cfg) return;
            mode = modeId;
            // Mỗi chế độ có tiêu chí tính "hoàn thành vòng" riêng, nên khi đổi
            // chế độ ta reset nhật ký (không reset thứ tự/idx để giữ đúng vị
            // trí từ đang xem).
            roundLog = [];
            document.querySelectorAll('.mode-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.mode === modeId);
            });
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            const panel = document.getElementById('panel-' + modeId);
            if (panel) {
                panel.classList.add('active');
                popAnimate(panel, 'animate__fadeIn');
            }
            cfg.render();
        }

        // ===== SINH TAB TỰ ĐỘNG TỪ CONFIG =====
        function buildLevelTabs() {
            const box = document.getElementById('level-tabs');
            box.innerHTML = '';
            LEVELS.forEach(lv => {
                const btn = document.createElement('button');
                btn.className = 'level-btn';
                btn.dataset.level = lv.id;
                btn.textContent = lv.label;
                btn.onclick = () => setLevel(lv.id);
                attachRipple(btn);
                box.appendChild(btn);
            });
        }

        function buildModeTabs() {
            const box = document.getElementById('modes-bar');
            box.innerHTML = '';
            MODES.forEach((m, i) => {
                const btn = document.createElement('button');
                btn.className = 'mode-btn' + (m.id === mode ? ' active' : '');
                btn.dataset.mode = m.id;
                btn.textContent = m.label;
                btn.onclick = () => switchMode(m.id);
                attachRipple(btn);
                box.appendChild(btn);
            });
        }

        // Nút "Xáo trộn" riêng của từng panel gọi lại đúng shuffle() đã khai
        // báo trong MODES, để logic xáo trộn cũng nằm tập trung một chỗ.
        function bindShuffleButtons() {
            const map = { flash: 'flash-shuffle', quiz: 'quiz-shuffle', type: 'type-shuffle' };
            MODES.forEach(m => {
                const btnId = map[m.id];
                if (!btnId) return; // mode mới tự đặt id nút riêng nếu cần
                const btn = document.getElementById(btnId);
                if (btn) btn.onclick = () => m.shuffle();
            });
        }

        // =====================================================================
        // TÌM KIẾM TOÀN CỤC — lấy dữ liệu từ tất cả các file JSON HSK đang có
        // (tự tải file nào chưa được tải), lọc theo Hán tự / pinyin / nghĩa,
        // hiển thị kết quả ngay khi gõ (debounce ~250ms, KHÔNG cần Enter).
        // =====================================================================
        const SEARCH_MAX_RESULTS = 40;
        let allVocabLoadPromise = null;

        // Tải toàn bộ các level chưa có trong cache, gộp lại thành 1 promise
        // dùng chung để tránh gọi tải trùng lặp khi search nhiều lần liên tiếp.
        function ensureAllVocabLoaded() {
            const missing = LEVELS.filter(lv => !VOCAB_BY_LEVEL[lv.id]);
            if (!missing.length) return Promise.resolve();
            if (!allVocabLoadPromise) {
                allVocabLoadPromise = Promise.all(missing.map(lv => loadVocab(lv.id)))
                    .finally(() => { allVocabLoadPromise = null; });
            }
            return allVocabLoadPromise;
        }

        function escapeHtml(s) {
            return (s == null ? '' : String(s))
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        // Bỏ dấu tiếng Việt + về chữ thường để so khớp không phân biệt dấu/hoa-thường
        function normalizeSearchText(s) {
            return (s == null ? '' : String(s))
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/đ/g, 'd')
                .trim();
        }

        function highlightMatch(text, query) {
            const t = text == null ? '' : String(text);
            const nq = normalizeSearchText(query);
            if (!nq) return escapeHtml(t);
            const norm = normalizeSearchText(t);
            const i = norm.indexOf(nq);
            if (i === -1) return escapeHtml(t);
            return escapeHtml(t.slice(0, i)) +
                '<span class="sr-mark">' + escapeHtml(t.slice(i, i + nq.length)) + '</span>' +
                escapeHtml(t.slice(i + nq.length));
        }

        // Quét toàn bộ VOCAB_BY_LEVEL (mọi file JSON đã tải) tìm từ khớp
        function searchAllVocab(query) {
            const raw = query.trim();
            const nq = normalizeSearchText(raw);
            if (!nq) return [];
            const results = [];
            for (const lv of LEVELS) {
                const list = VOCAB_BY_LEVEL[lv.id];
                if (!list) continue;
                for (const w of list) {
                    const hanziMatch = w.h && w.h.includes(raw);
                    const pinyinMatch = w.p && normalizeSearchText(w.p).includes(nq);
                    const meaningMatch = w.m && normalizeSearchText(w.m).includes(nq);
                    if (hanziMatch || pinyinMatch || meaningMatch) {
                        results.push({ h: w.h, p: w.p, m: w.m, level: lv.id, levelLabel: lv.label });
                        if (results.length >= SEARCH_MAX_RESULTS) return results;
                    }
                }
            }
            return results;
        }

        const searchResultsBox = document.getElementById('search-results');

        function renderSearchLoading() {
            searchResultsBox.innerHTML = '<div class="search-loading">⏳ Đang tải dữ liệu để tìm...</div>';
            searchResultsBox.classList.add('show');
        }

        function renderSearchResults(query, results) {
            if (!query.trim()) {
                searchResultsBox.classList.remove('show');
                searchResultsBox.innerHTML = '';
                return;
            }
            if (!results.length) {
                searchResultsBox.innerHTML = '<div class="search-empty">Không tìm thấy "' + escapeHtml(query.trim()) + '"</div>';
                searchResultsBox.classList.add('show');
                return;
            }
            searchResultsBox.innerHTML = results.map(r => `
                <div class="search-result-item" data-level="${r.level}" data-hanzi="${escapeHtml(r.h)}">
                    <div class="sr-hanzi">${escapeHtml(r.h)}</div>
                    <div class="sr-body">
                        <div class="sr-pinyin">${highlightMatch(r.p, query)}</div>
                        <div class="sr-meaning">${highlightMatch(r.m, query)}</div>
                    </div>
                    <div class="sr-level">${escapeHtml(r.levelLabel)}</div>
                </div>
            `).join('');
            searchResultsBox.classList.add('show');
            searchResultsBox.querySelectorAll('.search-result-item').forEach(item => {
                item.onclick = () => jumpToWord(+item.dataset.level, item.dataset.hanzi);
            });
        }

        // Nhảy tới đúng từ đã chọn: chuyển cấp độ tương ứng, đặt thẻ hiện tại
        // trỏ đúng vào từ đó, rồi mở chế độ Thẻ ghi nhớ.
        async function jumpToWord(level, hanzi) {
            searchResultsBox.classList.remove('show');
            await setLevel(level);
            const pos = VOCAB.findIndex(w => w.h === hanzi);
            if (pos === -1) return;
            const orderPos = order.indexOf(pos);
            idx = orderPos === -1 ? 0 : orderPos;
            switchMode('flash');
            toast('Đã chuyển tới: ' + hanzi);
        }

        function initSearch() {
            const input = document.getElementById('global-search');
            const clearBtn = document.getElementById('search-clear');
            let debounceTimer = null;

            input.addEventListener('input', () => {
                const q = input.value;
                clearBtn.style.display = q ? 'inline-block' : 'none';
                clearTimeout(debounceTimer);

                if (!q.trim()) {
                    renderSearchResults(q, []);
                    return;
                }

                debounceTimer = setTimeout(async () => {
                    const needsLoad = LEVELS.some(lv => !VOCAB_BY_LEVEL[lv.id]);
                    if (needsLoad) renderSearchLoading();
                    await ensureAllVocabLoaded();
                    // Nếu người dùng đã gõ thêm/khác trong lúc chờ tải, dùng giá trị mới nhất
                    const latestQuery = input.value;
                    renderSearchResults(latestQuery, searchAllVocab(latestQuery));
                }, 250);
            });

            clearBtn.onclick = () => {
                input.value = '';
                clearBtn.style.display = 'none';
                renderSearchResults('', []);
                input.focus();
            };

            input.addEventListener('focus', () => {
                if (input.value.trim() && searchResultsBox.innerHTML) {
                    searchResultsBox.classList.add('show');
                }
            });

            input.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    input.value = '';
                    clearBtn.style.display = 'none';
                    renderSearchResults('', []);
                    input.blur();
                } else if (e.key === 'Enter') {
                    // Enter chỉ là tiện ích nhảy nhanh tới kết quả đầu tiên —
                    // kết quả vốn đã tự hiển thị khi gõ, không bắt buộc phải bấm.
                    const first = searchResultsBox.querySelector('.search-result-item');
                    if (first) first.click();
                }
            });

            document.addEventListener('click', e => {
                if (!document.getElementById('search-wrap').contains(e.target)) {
                    searchResultsBox.classList.remove('show');
                }
            });
        }

        // ===== INIT =====
        buildLevelTabs();
        buildModeTabs();
        bindShuffleButtons();
        attachRippleAll();
        initSearch();

        (async () => {
            const savedLevel = parseInt(localStorage.getItem('hsk_last_level')) || LEVELS[0].id;
            await setLevel(savedLevel);
        })();

        document.body.addEventListener('click', () => {
            if (audioCtx.state === 'suspended') audioCtx.resume();
        }, { once: true });