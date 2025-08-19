require('dotenv').config() // Load .env file
const axios = require('axios')
const { Client, GatewayIntentBits, ActivityType } = require('discord.js')

const client = new Client({ 
	intents: [GatewayIntentBits.Guilds] 
})

async function pingForPlayers() {
	try {
		// Ping API for server data with more detailed info
		const res = await axios.get(`https://api.mcsrvstat.us/2/${process.env.MC_SERVER_IP}`)
		
		// If we got a valid response
		if(res.data && res.data.players) {
			let playerCount = res.data.players.online || 0
			let maxPlayers = res.data.players.max || 0
			let serverVersion = res.data.version || 'Unknown'
			let playerList = res.data.players.list || []
			
			// Create activity text with more info
			let activityText = `${playerCount}/${maxPlayers} players`
			
			// Add first few player names if available
			if (playerList.length > 0) {
				let displayNames = playerList.slice(0, 3).join(', ')
				if (playerList.length > 3) {
					displayNames += ` +${playerList.length - 3} more`
				}
				activityText = `${playerCount}/${maxPlayers}: ${displayNames}`
			}
			
			client.user.setActivity(activityText, {
				type: ActivityType.Watching
			})
			
			// Update voice channel name if configured
			if (process.env.VOICE_CHANNEL_ID) {
				try {
					console.log(`Looking for voice channel ID: ${process.env.VOICE_CHANNEL_ID}`)
					const voiceChannel = client.channels.cache.get(process.env.VOICE_CHANNEL_ID)
					if (voiceChannel) {
						const channelName = `🎮 Players: ${playerCount}/${maxPlayers}`
						console.log(`Current channel name: "${voiceChannel.name}", New name: "${channelName}"`)
						if (voiceChannel.name !== channelName) {
							await voiceChannel.setName(channelName)
							console.log(`✅ Updated voice channel name: ${channelName}`)
						} else {
							console.log(`⏭️ Channel name already correct`)
						}
					} else {
						console.log(`❌ Voice channel not found with ID: ${process.env.VOICE_CHANNEL_ID}`)
					}
				} catch (voiceErr) {
					console.log('❌ Error updating voice channel:', voiceErr.message)
				}
			} else {
				console.log('⚠️ VOICE_CHANNEL_ID not set in .env')
			}
			
			console.log(`Updated: ${playerCount}/${maxPlayers} players${playerList.length > 0 ? ` (${playerList.join(', ')})` : ''}`)
		} else {
			client.user.setActivity('Server offline', {
				type: ActivityType.Watching
			})
			
			// Update voice channel for offline server
			if (process.env.VOICE_CHANNEL_ID) {
				try {
					const voiceChannel = client.channels.cache.get(process.env.VOICE_CHANNEL_ID)
					if (voiceChannel) {
						const channelName = '🔴 Server Offline'
						if (voiceChannel.name !== channelName) {
							await voiceChannel.setName(channelName)
						}
					}
				} catch (voiceErr) {
					console.log('Error updating voice channel:', voiceErr.message)
				}
			}
			
			console.log('Server appears to be offline or unreachable')
		}
	} catch (err) {
		client.user.setActivity('Connection error', {
			type: ActivityType.Watching
		})
		
		// Update voice channel for connection error
		if (process.env.VOICE_CHANNEL_ID) {
			try {
				const voiceChannel = client.channels.cache.get(process.env.VOICE_CHANNEL_ID)
				if (voiceChannel) {
					const channelName = '❌ Connection Error'
					if (voiceChannel.name !== channelName) {
						await voiceChannel.setName(channelName)
					}
				}
			} catch (voiceErr) {
				console.log('Error updating voice channel:', voiceErr.message)
			}
		}
		
		console.log('Error pinging api.mcsrvstat.us for data:', err.message)
	}
}

// Runs when client connects to Discord.
client.once('ready', () => {
	console.log('Logged in as', client.user.tag)

	pingForPlayers() // Ping server once on startup
	// Ping the server and set the new status message every x minutes. (Minimum of 1 minute)
	setInterval(pingForPlayers, Math.max(1, process.env.MC_PING_FREQUENCY || 1) * 60 * 1000)
})

// Graceful shutdown handler
async function gracefulShutdown(signal) {
	console.log(`\n🛑 Received ${signal}, shutting down gracefully...`)
	
	// Update voice channel to show bot is offline
	if (process.env.VOICE_CHANNEL_ID && client.isReady()) {
		try {
			const voiceChannel = client.channels.cache.get(process.env.VOICE_CHANNEL_ID)
			if (voiceChannel) {
				await voiceChannel.setName('🔴 Bot Offline')
				console.log('✅ Updated voice channel to show bot offline')
			}
		} catch (err) {
			console.log('❌ Error updating voice channel on shutdown:', err.message)
		}
	}
	
	// Gracefully close Discord connection
	if (client.isReady()) {
		await client.destroy()
		console.log('✅ Discord connection closed')
	}
	
	console.log('👋 Bot shutdown complete')
	process.exit(0)
}

// Handle different shutdown signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'))   // Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')) // Process manager termination
process.on('beforeExit', () => gracefulShutdown('beforeExit'))

// Handle uncaught exceptions
process.on('uncaughtException', async (err) => {
	console.error('💥 Uncaught Exception:', err)
	await gracefulShutdown('uncaughtException')
})

process.on('unhandledRejection', async (reason, promise) => {
	console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason)
	await gracefulShutdown('unhandledRejection')
})

// Login to Discord
client.login(process.env.DISCORD_TOKEN)
