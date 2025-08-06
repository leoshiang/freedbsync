class ProgressBar {
	constructor(total, width = 40) {
		this.total = total;
		this.current = 0;
		this.width = width;
		this.startTime = Date.now();
	}

	update(current, info = '') {
		this.current = current;
		const percentage = Math.round((current / this.total) * 100);
		const filled = Math.round((current / this.total) * this.width);
		const empty = this.width - filled;

		// 計算剩餘時間
		const elapsed = Date.now() - this.startTime;
		const rate = current / elapsed;
		const remaining = current > 0 ? (this.total - current) / rate : 0;

		const bar = '█'.repeat(filled) + '░'.repeat(empty);
		const timeStr = this.formatTime(remaining);

		// 使用 \r 回到行首覆蓋舊內容
		process.stdout.write(`\r[${bar}] ${percentage}% (${current}/${this.total}) ${timeStr} ${info}`);

		// 完成時換行
		if (current >= this.total) {
			console.log();
		}
	}

	formatTime(ms) {
		if (ms <= 0) return '';
		const seconds = Math.ceil(ms / 1000);
		if (seconds < 60) return `剩餘 ${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `剩餘 ${minutes}m${remainingSeconds}s`;
	}

	finish(message = '完成') {
		this.update(this.total, message);
	}
}

module.exports = ProgressBar;
