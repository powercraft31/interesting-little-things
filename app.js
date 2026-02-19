// ============================================
// SOLFACIL - Gestão de Ativos de Energia
// Perspectiva: Fintech / Ativos Financeiros
// Multi-language Support: 中文, English, Português
// ============================================

// Translation System
const translations = {
    'zh': {
        // Header
        'portfolio_title': '资产组合',
        'arbitrage_title': '套利交易',
        'assets_title': '资产管理',
        'reports_title': '财务报告',
        'portfolio_value': '投资组合价值',
        'monthly_roi': '月度投资回报率',
        'today_profit': '今日利润',
        'energy_management': '能源资产管理',
        'fintech_solar': '太阳能金融科技',

        // Dashboard
        'profit_dashboard': '利润面板',
        'quick_actions': '快捷操作',

        // KPI Cards
        'gross_revenue': '今日总收入',
        'gross_revenue_today': '今日总收入',
        'loading_cost': '充电成本',
        'net_profit': '净利润',
        'arbitrage_spread': '套利价差',
        'today': '今日',
        'month': '本月',
        'vs_yesterday': '较昨日',
        'window_open': '套利窗口开启',

        // Charts
        'revenue_cost_24h': '24小时收入 vs 成本曲线',
        'accumulated_profit': '累计利润',
        'market_conditions': '市场行情',
        'sell': '卖出',
        'buy': '买入',
        'wait': '等待',
        'trade_simulation': '交易机会模拟',
        'simulate_opportunity': '模拟交易机会',
        'profit': '利润',
        'loss': '亏损',
        'current_tariff': '当前电价',
        'charge_cost': '充电成本',
        'current_margin': '当前利润率',
        'next_window': '下个窗口',
        'sell_now': '立即卖出 - 利润率最高',

        // Arbitrage
        'arbitrage_window': '套利窗口 - 白色电价',
        'arbitrage_trades': '今日交易计划',
        'trade_execution': '交易执行',
        'time': '时间',
        'tariff': '电价类型',
        'operation': '操作',
        'price': '价格',
        'volume': '交易量',
        'result': '结果',
        'status': '状态',
        'trade_summary': '交易汇总',
        'total_bought': '总买入量',
        'total_sold': '总卖出量',
        'arbitrage_profit': '套利利润',
        'profit_margin': '利润率',
        'cost': '成本',
        'revenue': '收入',
        'margin': '利润率',
        'live': '实时',

        // Assets
        'portfolio_assets': '资产组合',
        'portfolio_overview': '投资组合概览',
        'total_investment': '总投资',
        'total_capacity': '总容量',
        'avg_payback': '预计回收期',
        'annual_irr': '预计内部收益率',
        'assets_performance': '资产表现',
        'investment': '投资额',
        'units': '单位数',
        'payback': '回收期',
        'region': '地区',
        'operating': '运营中',
        'charging': '充电中',
        'active_assets': '个活跃资产',
        'per_year': '每年',
        'daily_progress': '日进度',
        'vs_target': '对比目标',

        // Reports
        'financial_reports': '财务报告',
        'revenue_trend': '收入趋势',
        'revenue_trend_7d': '收入趋势（近7天）',
        'revenue_breakdown': '收入构成',
        'financial_summary': '财务摘要',
        'cost_analysis': '成本分析',
        'return_indicators': '回报指标',
        'roi_metrics': '投资回报指标',
        'monthly': '月度',
        'annual': '年度',
        'gross_margin': '毛利率',
        '7_days': '7 天',
        '30_days': '30 天',
        '90_days': '90 天',
        'tariff_arbitrage': '电价套利',
        'demand_response': '需求响应',
        'ancillary_services': '辅助服务',
        'total_weekly_revenue': '周总收入',
        'charge_cost_offpeak': '充电成本（非尖峰）',
        'battery_om': '电池运维',
        'connection_costs': '连接费用',
        'weekly_net_profit': '周净利润',

        // Status
        'executed': '已执行',
        'executing': '执行中',
        'scheduled': '已计划',
        'hold': '持有',
        'partial_sell': '部分卖出',
        'total_sell': '全部卖出',
        'partial_buy': '买入',
        'buy_operation': '买入',
        'sell_operation': '卖出',

        // Periods
        'peak': '尖峰时段',
        'intermediate': '中间时段',
        'off_peak': '非尖峰时段',
        'mon': '周一', 'tue': '周二', 'wed': '周三', 'thu': '周四', 'fri': '周五', 'sat': '周六', 'sun': '周日',

        // Quick Actions
        'performance_report': '表现报告',
        'asset_management': '资产管理',

        // Trade Modal
        'trade_opportunity': '交易机会',
        'trade_opportunity_detected': '检测到交易机会！',
        'market_signal_label': '市场信号',
        'market_signal_desc': '尖峰电价上涨15%（高于均价）',
        'recommended_action': '推荐操作',
        'recommended_action_desc': '立即卖出 4.0 MWh',
        'estimated_duration': '预计持续时间',
        'estimated_duration_desc': '2小时',
        'available_capacity': '可用容量',
        'spot_price': '现货价格',
        'estimated_profit': '预计利润',
        'execute_trade': '执行交易',
        'accept_trade': '接受交易',
        'view_details': '查看详情',
        'reject': '拒绝',
        'high_profit_margin': '高利润率',

        // Alert messages
        'trade_executed_msg': '交易执行成功！',
        'selling_detail': '卖出 4.0 MWh，价格 R$ 2.50/kWh',
        'profit_estimate_10k': '预计利润：R$ 10,000',
        'operation_registered': '操作已记录在投资组合中。',
        'opportunity_details_title': '机会详情',
        'detail_capacity': '可用容量：8.5 MWh',
        'detail_assets_online': '在线资产：2,847 个',
        'detail_avg_soc': '平均 SoC：65%',
        'detail_spot_price': '现货价格：R$ 2.50/kWh',
        'detail_avg_charge': '平均充电成本：R$ 0.25/kWh',
        'detail_gross_margin': '毛利率：90%',
        'detail_est_revenue': '预计收入：R$ 21,250',
        'detail_est_net_profit': '预计净利润：R$ 19,125',

        // Market signals
        'signal_buy_charge': '买入 - 最低充电成本',
        'signal_wait_peak': '等待 - 尖峰时段即将到来',
        'signal_prepare_buy': '准备买入 - 非尖峰即将到来',
        'peak_max_margin': '尖峰 - 最大利润率',

        // Batch Operations
        'select_all': '全选',
        'selected': '已选',
        'sites': '站点',
        'reset_selection': '重置选择',
        'target_mode': '目标模式',
        'mode_self_consumption': '自发自用',
        'mode_peak_valley_arbitrage': '峰谷套利',
        'mode_peak_shaving': '削峰模式',
        'mode_self_desc': '优先自用, 多余才卖',
        'mode_pv_desc': '全额买入/卖出 (VPP)',
        'mode_ps_desc': '功率限制, 避免罚款',
        'batch_dispatch': '批量下发模式',
        'current_mode': '当前模式',
        'confirm_batch_change': '确认批量模式更改',
        'confirm_batch_desc': '您即将更改以下站点的运行模式:',
        'confirm_dispatch': '确认下发',
        'cancel': '取消',
        'batch_dispatching': '批量模式下发中...',
        'overall_progress': '总进度',
        'close': '关闭',
        'retry_failed': '重试失败项',
        'dispatch_success': '成功',
        'dispatch_failed': '失败',
        'dispatch_waiting': '等待中',
        'batch_complete': '批量模式更改完成',
        'batch_impact_warning': '模式更改将在下一个调度周期生效',
        'affected_sites': '个站点',
        'affected_units': '台设备',
        'communication_timeout': '设备通信超时',
        'all_in_target_mode': '所有选中站点已在目标模式下',
        'success_count': '成功',
        'failed_count': '失败',

        // Other
        'years': '年',
        'year': '年',
        'mwh': '兆瓦时',
        'solfacil': 'SOLFACIL',
        'average': '平均',
        'daily_target': '日目标',
        'soc': '充电状态'
    },

    'en': {
        // Header
        'portfolio_title': 'Portfolio',
        'arbitrage_title': 'Arbitrage',
        'assets_title': 'Assets',
        'reports_title': 'Reports',
        'portfolio_value': 'Portfolio Value',
        'monthly_roi': 'Monthly ROI',
        'today_profit': 'Today\'s Profit',
        'energy_management': 'Energy Asset Management',
        'fintech_solar': 'Solar Fintech',

        // Dashboard
        'profit_dashboard': 'Profit Dashboard',
        'quick_actions': 'Quick Actions',

        // KPI Cards
        'gross_revenue': 'Gross Revenue',
        'gross_revenue_today': 'Gross Revenue Today',
        'loading_cost': 'Loading Cost',
        'net_profit': 'Net Profit',
        'arbitrage_spread': 'Arbitrage Spread',
        'today': 'Today',
        'month': 'Month',
        'vs_yesterday': 'vs yesterday',
        'window_open': 'Window open',

        // Charts
        'revenue_cost_24h': '24h Revenue vs Cost Curve',
        'accumulated_profit': 'Accumulated Profit',
        'market_conditions': 'Market Conditions',
        'sell': 'SELL',
        'buy': 'BUY',
        'wait': 'WAIT',
        'trade_simulation': 'Trade Opportunity Simulation',
        'simulate_opportunity': 'Simulate Trading Opportunity',
        'profit': 'Profit',
        'loss': 'Loss',
        'current_tariff': 'Current Tariff',
        'charge_cost': 'Charge Cost',
        'current_margin': 'Current Margin',
        'next_window': 'Next Window',
        'sell_now': 'SELL NOW - Maximum margin active',

        // Arbitrage
        'arbitrage_window': 'Arbitrage Window - Tarifa Branca',
        'arbitrage_trades': 'Today\'s Trade Schedule',
        'trade_execution': 'Trade Execution',
        'time': 'Time',
        'tariff': 'Tariff',
        'operation': 'Operation',
        'price': 'Price',
        'volume': 'Volume',
        'result': 'Result',
        'status': 'Status',
        'trade_summary': 'Trade Summary',
        'total_bought': 'Total Bought',
        'total_sold': 'Total Sold',
        'arbitrage_profit': 'Arbitrage Profit',
        'profit_margin': 'Profit Margin',
        'cost': 'Cost',
        'revenue': 'Revenue',
        'margin': 'Margin',
        'live': 'Live',

        // Assets
        'portfolio_assets': 'Asset Portfolio',
        'portfolio_overview': 'Portfolio Overview',
        'total_investment': 'Total Investment',
        'total_capacity': 'Total Capacity',
        'avg_payback': 'Estimated Payback',
        'annual_irr': 'Projected IRR',
        'assets_performance': 'Assets Performance',
        'investment': 'Investment',
        'units': 'Units',
        'payback': 'Payback',
        'region': 'Region',
        'operating': 'Operating',
        'charging': 'Charging',
        'active_assets': 'active assets',
        'per_year': 'p.a.',
        'daily_progress': 'Daily Progress',
        'vs_target': 'vs target',

        // Reports
        'financial_reports': 'Financial Reports',
        'revenue_trend': 'Revenue Trend',
        'revenue_trend_7d': 'Revenue Trend (Last 7 Days)',
        'revenue_breakdown': 'Revenue Breakdown',
        'financial_summary': 'Financial Summary',
        'cost_analysis': 'Cost Analysis',
        'return_indicators': 'Return Indicators',
        'roi_metrics': 'ROI Metrics',
        'monthly': 'Monthly',
        'annual': 'Annual',
        'gross_margin': 'Gross Margin',
        '7_days': '7 days',
        '30_days': '30 days',
        '90_days': '90 days',
        'tariff_arbitrage': 'Tariff Arbitrage',
        'demand_response': 'Demand Response',
        'ancillary_services': 'Ancillary Services',
        'total_weekly_revenue': 'Total Weekly Revenue',
        'charge_cost_offpeak': 'Charge Cost (Off-Peak)',
        'battery_om': 'Battery O&M',
        'connection_costs': 'Connection Costs',
        'weekly_net_profit': 'Weekly Net Profit',

        // Status
        'executed': 'Executed',
        'executing': 'Executing',
        'scheduled': 'Scheduled',
        'hold': 'HOLD',
        'partial_sell': 'PARTIAL SELL',
        'total_sell': 'TOTAL SELL',
        'partial_buy': 'BUY',
        'buy_operation': 'BUY',
        'sell_operation': 'SELL',

        // Periods
        'peak': 'Peak',
        'intermediate': 'Intermediate',
        'off_peak': 'Off-Peak',
        'mon': 'Mon', 'tue': 'Tue', 'wed': 'Wed', 'thu': 'Thu', 'fri': 'Fri', 'sat': 'Sat', 'sun': 'Sun',

        // Quick Actions
        'performance_report': 'Performance Report',
        'asset_management': 'Asset Management',

        // Trade Modal
        'trade_opportunity': 'Trade Opportunity',
        'trade_opportunity_detected': 'Trade Opportunity Detected!',
        'market_signal_label': 'Market signal',
        'market_signal_desc': 'Peak price rose 15% above average',
        'recommended_action': 'Recommended action',
        'recommended_action_desc': 'Sell 4.0 MWh immediately',
        'estimated_duration': 'Estimated duration',
        'estimated_duration_desc': '2 hours',
        'available_capacity': 'Available capacity',
        'spot_price': 'Spot price',
        'estimated_profit': 'Estimated Profit',
        'execute_trade': 'Execute Trade',
        'accept_trade': 'Accept Trade',
        'view_details': 'View Details',
        'reject': 'Reject',
        'high_profit_margin': 'High profit margin',

        // Alert messages
        'trade_executed_msg': 'Trade executed successfully!',
        'selling_detail': 'Selling 4.0 MWh at R$ 2.50/kWh',
        'profit_estimate_10k': 'Estimated profit: R$ 10,000',
        'operation_registered': 'Operation registered in portfolio.',
        'opportunity_details_title': 'Opportunity Details',
        'detail_capacity': 'Available capacity: 8.5 MWh',
        'detail_assets_online': 'Assets online: 2,847 units',
        'detail_avg_soc': 'Average SoC: 65%',
        'detail_spot_price': 'Spot price: R$ 2.50/kWh',
        'detail_avg_charge': 'Avg. charge cost: R$ 0.25/kWh',
        'detail_gross_margin': 'Gross margin: 90%',
        'detail_est_revenue': 'Estimated revenue: R$ 21,250',
        'detail_est_net_profit': 'Estimated net profit: R$ 19,125',

        // Market signals
        'signal_buy_charge': 'BUY - Minimum charge cost',
        'signal_wait_peak': 'WAIT - Peak coming soon',
        'signal_prepare_buy': 'PREPARE BUY - Off-peak coming soon',
        'peak_max_margin': 'Peak - Maximum Margin',

        // Batch Operations
        'select_all': 'Select All',
        'selected': 'Selected',
        'sites': 'sites',
        'reset_selection': 'Reset',
        'target_mode': 'Target Mode',
        'mode_self_consumption': 'Self-Consumption',
        'mode_peak_valley_arbitrage': 'Peak-Valley Arbitrage',
        'mode_peak_shaving': 'Peak Shaving',
        'mode_self_desc': 'Self-use first, sell excess',
        'mode_pv_desc': 'Full buy/sell (VPP)',
        'mode_ps_desc': 'Power limit, avoid penalties',
        'batch_dispatch': 'Batch Dispatch Mode',
        'current_mode': 'Current Mode',
        'confirm_batch_change': 'Confirm Batch Mode Change',
        'confirm_batch_desc': 'You are about to change the operating mode for:',
        'confirm_dispatch': 'Confirm Dispatch',
        'cancel': 'Cancel',
        'batch_dispatching': 'Batch Mode Dispatching...',
        'overall_progress': 'Overall Progress',
        'close': 'Close',
        'retry_failed': 'Retry Failed',
        'dispatch_success': 'Success',
        'dispatch_failed': 'Failed',
        'dispatch_waiting': 'Waiting',
        'batch_complete': 'Batch Mode Change Complete',
        'batch_impact_warning': 'Mode change takes effect next scheduling cycle',
        'affected_sites': 'sites',
        'affected_units': 'devices',
        'communication_timeout': 'Communication timeout',
        'all_in_target_mode': 'All selected sites are already in target mode',
        'success_count': 'Success',
        'failed_count': 'Failed',

        // Other
        'years': 'years',
        'year': 'year',
        'mwh': 'MWh',
        'solfacil': 'SOLFACIL',
        'average': 'Average',
        'daily_target': 'daily target',
        'soc': 'SoC'
    },

    'pt': {
        // Header
        'portfolio_title': 'Portfólio',
        'arbitrage_title': 'Arbitragem',
        'assets_title': 'Ativos',
        'reports_title': 'Relatórios',
        'portfolio_value': 'Valor do Portfólio',
        'monthly_roi': 'ROI Mensal',
        'today_profit': 'Lucro Hoje',
        'energy_management': 'Gestão de Ativos de Energia',
        'fintech_solar': 'Fintech Solar',

        // Dashboard
        'profit_dashboard': 'Painel de Lucros',
        'quick_actions': 'Ações Rápidas',

        // KPI Cards
        'gross_revenue': 'Receita Bruta',
        'gross_revenue_today': 'Receita Bruta Hoje',
        'loading_cost': 'Custo de Carga',
        'net_profit': 'Lucro Líquido',
        'arbitrage_spread': 'Spread de Arbitragem',
        'today': 'Hoje',
        'month': 'Mês',
        'vs_yesterday': 'vs ontem',
        'window_open': 'Janela aberta',

        // Charts
        'revenue_cost_24h': 'Curva de Receita vs Custo (24h)',
        'accumulated_profit': 'Lucro Acumulado',
        'market_conditions': 'Condições de Mercado',
        'sell': 'VENDER',
        'buy': 'COMPRAR',
        'wait': 'AGUARDAR',
        'trade_simulation': 'Simulação de Oportunidade de Trade',
        'simulate_opportunity': 'Simular Oportunidade de Trade',
        'profit': 'Lucro',
        'loss': 'Prejuízo',
        'current_tariff': 'Tarifa Atual',
        'charge_cost': 'Custo de Carga',
        'current_margin': 'Margem Atual',
        'next_window': 'Próxima Janela',
        'sell_now': 'VENDER AGORA - Margem máxima ativa',

        // Arbitrage
        'arbitrage_window': 'Janela de Arbitragem - Tarifa Branca',
        'arbitrage_trades': 'Agenda de Trades Hoje',
        'trade_execution': 'Execução de Trades',
        'time': 'Horário',
        'tariff': 'Tipo de Tarifa',
        'operation': 'Operação',
        'price': 'Preço',
        'volume': 'Volume',
        'result': 'Resultado',
        'status': 'Status',
        'trade_summary': 'Resumo de Trades',
        'total_bought': 'Total Comprado',
        'total_sold': 'Total Vendido',
        'arbitrage_profit': 'Lucro de Arbitragem',
        'profit_margin': 'Margem de Lucro',
        'cost': 'Custo',
        'revenue': 'Receita',
        'margin': 'Margem',
        'live': 'Ao vivo',

        // Assets
        'portfolio_assets': 'Portfólio de Ativos',
        'portfolio_overview': 'Visão Geral do Portfólio',
        'total_investment': 'Investimento Total',
        'total_capacity': 'Capacidade Total',
        'avg_payback': 'Payback Estimado',
        'annual_irr': 'TIR Projetada',
        'assets_performance': 'Performance dos Ativos',
        'investment': 'Investimento',
        'units': 'Unidades',
        'payback': 'Payback',
        'region': 'Região',
        'operating': 'Operando',
        'charging': 'Carregando',
        'active_assets': 'ativos ativos',
        'per_year': 'a.a.',
        'daily_progress': 'Progresso Diário',
        'vs_target': 'vs meta',

        // Reports
        'financial_reports': 'Relatórios Financeiros',
        'revenue_trend': 'Tendência de Receita',
        'revenue_trend_7d': 'Evolução da Receita (Últimos 7 dias)',
        'revenue_breakdown': 'Composição da Receita',
        'financial_summary': 'Resumo Financeiro',
        'cost_analysis': 'Análise de Custos',
        'return_indicators': 'Indicadores de Retorno',
        'roi_metrics': 'Métricas de ROI',
        'monthly': 'Mensal',
        'annual': 'Anual',
        'gross_margin': 'Margem Bruta',
        '7_days': '7 dias',
        '30_days': '30 dias',
        '90_days': '90 dias',
        'tariff_arbitrage': 'Arbitragem Tarifária',
        'demand_response': 'Resposta à Demanda',
        'ancillary_services': 'Serviços Ancilares',
        'total_weekly_revenue': 'Receita Total Semanal',
        'charge_cost_offpeak': 'Custo de Carga (fora ponta)',
        'battery_om': 'O&M Baterias',
        'connection_costs': 'Custos de Conexão',
        'weekly_net_profit': 'Lucro Líquido Semanal',

        // Status
        'executed': 'Executado',
        'executing': 'Em execução',
        'scheduled': 'Agendado',
        'hold': 'HOLD',
        'partial_sell': 'VENDA PARCIAL',
        'total_sell': 'VENDA TOTAL',
        'partial_buy': 'COMPRA',
        'buy_operation': 'COMPRA',
        'sell_operation': 'VENDA',

        // Periods
        'peak': 'Ponta',
        'intermediate': 'Intermediária',
        'off_peak': 'Fora Ponta',
        'mon': 'Seg', 'tue': 'Ter', 'wed': 'Qua', 'thu': 'Qui', 'fri': 'Sex', 'sat': 'Sáb', 'sun': 'Dom',

        // Quick Actions
        'performance_report': 'Relatório de Performance',
        'asset_management': 'Gestão de Ativos',

        // Trade Modal
        'trade_opportunity': 'Oportunidade de Trade',
        'trade_opportunity_detected': 'Oportunidade de Trade Detectada!',
        'market_signal_label': 'Sinal de mercado',
        'market_signal_desc': 'Preço de ponta subiu 15% acima da média',
        'recommended_action': 'Ação recomendada',
        'recommended_action_desc': 'Vender 4,0 MWh imediatamente',
        'estimated_duration': 'Duração estimada',
        'estimated_duration_desc': '2 horas',
        'available_capacity': 'Capacidade disponível',
        'spot_price': 'Preço spot',
        'estimated_profit': 'Lucro Estimado',
        'execute_trade': 'Executar Trade',
        'accept_trade': 'Aceitar Trade',
        'view_details': 'Ver Detalhes',
        'reject': 'Recusar',
        'high_profit_margin': 'Margem de lucro alta',

        // Alert messages
        'trade_executed_msg': 'Trade executado com sucesso!',
        'selling_detail': 'Vendendo 4,0 MWh a R$ 2,50/kWh',
        'profit_estimate_10k': 'Lucro estimado: R$ 10.000',
        'operation_registered': 'Operação registrada no portfólio.',
        'opportunity_details_title': 'Detalhes da Oportunidade',
        'detail_capacity': 'Capacidade disponível: 8,5 MWh',
        'detail_assets_online': 'Ativos online: 2.847 unidades',
        'detail_avg_soc': 'SoC médio: 65%',
        'detail_spot_price': 'Preço spot: R$ 2,50/kWh',
        'detail_avg_charge': 'Custo médio de carga: R$ 0,25/kWh',
        'detail_gross_margin': 'Margem bruta: 90%',
        'detail_est_revenue': 'Receita estimada: R$ 21.250',
        'detail_est_net_profit': 'Lucro líquido estimado: R$ 19.125',

        // Market signals
        'signal_buy_charge': 'COMPRAR - Custo mínimo de carga',
        'signal_wait_peak': 'AGUARDAR - Ponta em breve',
        'signal_prepare_buy': 'PREPARAR COMPRA - Fora ponta em breve',
        'peak_max_margin': 'Ponta - Margem Máxima',

        // Batch Operations
        'select_all': 'Selecionar Tudo',
        'selected': 'Selecionados',
        'sites': 'sites',
        'reset_selection': 'Resetar',
        'target_mode': 'Modo Alvo',
        'mode_self_consumption': 'Autoconsumo',
        'mode_peak_valley_arbitrage': 'Arbitragem Ponta-Fora Ponta',
        'mode_peak_shaving': 'Corte de Pico',
        'mode_self_desc': 'Prioridade ao autoconsumo',
        'mode_pv_desc': 'Compra/venda total (VPP)',
        'mode_ps_desc': 'Limite de potência, evitar multas',
        'batch_dispatch': 'Despacho em Lote',
        'current_mode': 'Modo Atual',
        'confirm_batch_change': 'Confirmar Alteração em Lote',
        'confirm_batch_desc': 'Você está prestes a alterar o modo de operação de:',
        'confirm_dispatch': 'Confirmar Despacho',
        'cancel': 'Cancelar',
        'batch_dispatching': 'Despachando Modos em Lote...',
        'overall_progress': 'Progresso Geral',
        'close': 'Fechar',
        'retry_failed': 'Tentar Novamente',
        'dispatch_success': 'Sucesso',
        'dispatch_failed': 'Falha',
        'dispatch_waiting': 'Aguardando',
        'batch_complete': 'Alteração em Lote Concluída',
        'batch_impact_warning': 'Alteração entra em vigor no próximo ciclo',
        'affected_sites': 'sites',
        'affected_units': 'dispositivos',
        'communication_timeout': 'Timeout de comunicação',
        'all_in_target_mode': 'Todos os sites já estão no modo alvo',
        'success_count': 'Sucesso',
        'failed_count': 'Falha',

        // Other
        'years': 'anos',
        'year': 'ano',
        'mwh': 'MWh',
        'solfacil': 'SOLFACIL',
        'average': 'Médio',
        'daily_target': 'meta diária',
        'soc': 'SoC'
    }
};

// ============================================
// Language Management
// ============================================
let currentLanguage = localStorage.getItem('solfacilLanguage') || 'zh';

function t(key) {
    return translations[currentLanguage][key] || translations['pt'][key] || key;
}

function changeLanguage(lang) {
    currentLanguage = lang;
    localStorage.setItem('solfacilLanguage', lang);
    updateAllTranslations();

    // Repopulate dynamic content
    const table = document.getElementById('tradeTable');
    if (table) { table.innerHTML = ''; populateTrades(); }

    const assetsGrid = document.getElementById('assetsGrid');
    if (assetsGrid) { assetsGrid.innerHTML = ''; populateAssets(); }

    // Update chart labels
    if (revenueCurveChart) {
        revenueCurveChart.data.datasets[0].label = `${t('revenue')} (R$)`;
        revenueCurveChart.data.datasets[1].label = `${t('cost')} (R$)`;
        revenueCurveChart.data.datasets[2].label = `${t('accumulated_profit')} (R$)`;
        revenueCurveChart.update();
    }

    if (arbitrageChart) {
        arbitrageChart.destroy();
        initializeArbitrageChart();
    }

    if (revenueTrendChart) {
        const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        revenueTrendChart.data.labels = weekdays.map(day => t(day));
        revenueTrendChart.data.datasets[0].label = t('gross_revenue');
        revenueTrendChart.data.datasets[1].label = t('cost');
        revenueTrendChart.data.datasets[2].label = t('net_profit');
        revenueTrendChart.update();
    }

    if (revenueBreakdownChart) {
        revenueBreakdownChart.data.labels = [t('tariff_arbitrage'), t('demand_response'), t('ancillary_services')];
        revenueBreakdownChart.update();
    }

    // Update market conditions immediately
    updateFinancialMetrics();
}

function updateAllTranslations() {
    // All elements with data-translate attribute
    document.querySelectorAll('[data-translate]').forEach(elem => {
        const key = elem.getAttribute('data-translate');
        const translation = translations[currentLanguage] && translations[currentLanguage][key];
        if (translation) {
            elem.textContent = translation;
        }
    });

    // Subtitle (compound text with separator)
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) subtitle.textContent = `${t('energy_management')} | ${t('fintech_solar')}`;

    // Language buttons active state
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLanguage);
    });

    // Page language attribute and title
    const langMap = { 'zh': 'zh-CN', 'en': 'en', 'pt': 'pt-BR' };
    document.documentElement.lang = langMap[currentLanguage] || 'pt-BR';
    document.title = `${t('solfacil')} - ${t('energy_management')}`;

    // Update date with correct locale
    setCurrentDate();
}

// ============================================
// Mock Data
// ============================================
const mockData = {
    assets: [
        {
            id: 'ASSET_SP_001',
            name: 'São Paulo - Casa Verde',
            region: 'SP',
            status: 'operando',
            investimento: 4200000,
            capacidade: 5.2,
            unidades: 948,
            socMedio: 65,
            receitaHoje: 18650,
            receitaMes: 412300,
            roi: 19.2,
            custoHoje: 4250,
            lucroHoje: 14400,
            payback: '3,8',
            operationMode: 'peak_valley_arbitrage'
        },
        {
            id: 'ASSET_RJ_002',
            name: 'Rio de Janeiro - Copacabana',
            region: 'RJ',
            status: 'operando',
            investimento: 3800000,
            capacidade: 4.8,
            unidades: 872,
            socMedio: 72,
            receitaHoje: 16420,
            receitaMes: 378500,
            roi: 17.8,
            custoHoje: 3890,
            lucroHoje: 12530,
            payback: '4,1',
            operationMode: 'self_consumption'
        },
        {
            id: 'ASSET_MG_003',
            name: 'Belo Horizonte - Pampulha',
            region: 'MG',
            status: 'operando',
            investimento: 2900000,
            capacidade: 3.6,
            unidades: 654,
            socMedio: 58,
            receitaHoje: 11280,
            receitaMes: 298400,
            roi: 16.4,
            custoHoje: 2680,
            lucroHoje: 8600,
            payback: '4,5',
            operationMode: 'peak_valley_arbitrage'
        },
        {
            id: 'ASSET_PR_004',
            name: 'Curitiba - Batel',
            region: 'PR',
            status: 'carregando',
            investimento: 1500000,
            capacidade: 2.0,
            unidades: 373,
            socMedio: 34,
            receitaHoje: 6100,
            receitaMes: 145800,
            roi: 15.1,
            custoHoje: 1895,
            lucroHoje: 4205,
            payback: '4,8',
            operationMode: 'peak_shaving'
        }
    ],
    trades: [
        { time: '00:00 - 06:00', tarifa: 'off_peak', operacao: 'buy', preco: 'R$ 0,25/kWh', volume: '15,6', resultado: '-R$ 3.900', status: 'executed' },
        { time: '06:00 - 09:00', tarifa: 'intermediate', operacao: 'hold', preco: 'R$ 0,45/kWh', volume: '—', resultado: 'R$ 0', status: 'executed' },
        { time: '09:00 - 12:00', tarifa: 'intermediate', operacao: 'partial_sell', preco: 'R$ 0,52/kWh', volume: '8,2', resultado: '+R$ 4.264', status: 'executed' },
        { time: '12:00 - 15:00', tarifa: 'intermediate', operacao: 'hold', preco: 'R$ 0,48/kWh', volume: '—', resultado: 'R$ 0', status: 'executed' },
        { time: '15:00 - 17:00', tarifa: 'intermediate', operacao: 'partial_sell', preco: 'R$ 0,55/kWh', volume: '6,8', resultado: '+R$ 3.740', status: 'executed' },
        { time: '17:00 - 20:00', tarifa: 'peak', operacao: 'total_sell', preco: 'R$ 0,82/kWh', volume: '23,6', resultado: '+R$ 19.352', status: 'executing' },
        { time: '20:00 - 22:00', tarifa: 'intermediate', operacao: 'buy', preco: 'R$ 0,42/kWh', volume: '10,8', resultado: '-R$ 4.536', status: 'scheduled' },
        { time: '22:00 - 00:00', tarifa: 'off_peak', operacao: 'buy', preco: 'R$ 0,25/kWh', volume: '20,8', resultado: '-R$ 5.200', status: 'scheduled' }
    ],
    revenueTrend: {
        receita: [42150, 38900, 45200, 48235, 51000, 39800, 41500],
        custo: [9800, 8700, 10200, 10850, 11500, 9200, 9600],
        lucro: [32350, 30200, 35000, 37385, 39500, 30600, 31900]
    },
    revenueBreakdown: {
        values: [32450, 12385, 3400],
        colors: ['#3730a3', '#059669', '#d97706']
    }
};

// ============================================
// Operation Modes Definition
// ============================================
const OPERATION_MODES = {
    self_consumption: {
        key: 'self_consumption',
        icon: 'home',
        color: '#059669',
        bgColor: '#ecfdf5',
        borderColor: '#a7f3d0'
    },
    peak_valley_arbitrage: {
        key: 'peak_valley_arbitrage',
        icon: 'swap_vert',
        color: '#3730a3',
        bgColor: '#eef2ff',
        borderColor: '#c7d2fe'
    },
    peak_shaving: {
        key: 'peak_shaving',
        icon: 'compress',
        color: '#d97706',
        bgColor: '#fffbeb',
        borderColor: '#fde68a'
    }
};

// ============================================
// Batch Operation State
// ============================================
const batchState = {
    selectedAssets: new Set(),
    targetMode: null,
    isDispatching: false,
    dispatchResults: []
};

// ============================================
// Global Variables
// ============================================
let revenueCurveChart;
let arbitrageChart;
let revenueTrendChart;
let revenueBreakdownChart;

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    updateAllTranslations();
    setupNavigation();
    setCurrentDate();
    initializeRevenueCurveChart();
    initializeArbitrageChart();
    initializeRevenueTrendChart();
    initializeRevenueBreakdownChart();
    populateAssets();
    initBatchToolbar();
    populateTrades();
    startRealTimeUpdates();
});

// ============================================
// Date Formatting (locale-aware)
// ============================================
function setCurrentDate() {
    const now = new Date();
    const localeMap = { 'zh': 'zh-CN', 'en': 'en-US', 'pt': 'pt-BR' };
    const locale = localeMap[currentLanguage] || 'pt-BR';
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString(locale, options);
    const el = document.getElementById('currentDate');
    if (el) el.textContent = dateStr;
}

// ============================================
// Navigation
// ============================================
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            const targetSection = item.getAttribute('data-section');
            sections.forEach(section => {
                section.classList.remove('active');
                if (section.id === targetSection) {
                    section.classList.add('active');
                }
            });
        });
    });
}

function navigateTo(sectionId) {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.section');
    navItems.forEach(nav => {
        nav.classList.remove('active');
        if (nav.getAttribute('data-section') === sectionId) {
            nav.classList.add('active');
        }
    });
    sections.forEach(section => {
        section.classList.remove('active');
        if (section.id === sectionId) {
            section.classList.add('active');
        }
    });
}

// ============================================
// Chart: Revenue vs Cost Curve (24h)
// ============================================
function initializeRevenueCurveChart() {
    const ctx = document.getElementById('revenueCurveChart');
    if (!ctx) return;

    const hours = Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`);

    const revenueData = hours.map((_, i) => {
        if (i >= 17 && i < 20) return Math.random() * 3000 + 6000;
        if ((i >= 9 && i < 12) || (i >= 15 && i < 17)) return Math.random() * 1500 + 1500;
        return 0;
    });

    const costData = hours.map((_, i) => {
        if (i < 6 || i >= 22) return Math.random() * 400 + 500;
        if (i >= 20 && i < 22) return Math.random() * 300 + 400;
        return 0;
    });

    let accumulated = 0;
    const profitData = hours.map((_, i) => {
        accumulated += (revenueData[i] - costData[i]);
        return accumulated;
    });

    revenueCurveChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: hours,
            datasets: [
                {
                    label: `${t('revenue')} (R$)`,
                    data: revenueData,
                    borderColor: '#059669',
                    backgroundColor: 'rgba(5, 150, 105, 0.1)',
                    tension: 0.4,
                    fill: false,
                    borderWidth: 2
                },
                {
                    label: `${t('cost')} (R$)`,
                    data: costData,
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    tension: 0.4,
                    fill: false,
                    borderWidth: 2
                },
                {
                    label: `${t('accumulated_profit')} (R$)`,
                    data: profitData,
                    borderColor: '#3730a3',
                    backgroundColor: 'rgba(55, 48, 163, 0.08)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 3,
                    borderDash: [5, 3]
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': R$ ' + context.parsed.y.toLocaleString('pt-BR', {minimumFractionDigits: 0});
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'R$ ' + (value / 1000).toFixed(0) + 'k';
                        }
                    },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

// ============================================
// Chart: Arbitrage Windows
// ============================================
function initializeArbitrageChart() {
    const ctx = document.getElementById('arbitrageChart');
    if (!ctx) return;

    const hours = Array.from({length: 24}, (_, i) => `${String(i).padStart(2, '0')}:00`);

    const sellPrice = hours.map((_, i) => {
        if (i >= 17 && i < 20) return 0.82;
        if ((i >= 6 && i < 17) || (i >= 20 && i < 22)) return 0.45 + Math.random() * 0.1;
        return 0.25;
    });

    const buyPrice = hours.map(() => 0.25);
    const margin = hours.map((_, i) => Math.max(0, sellPrice[i] - 0.25));

    arbitrageChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: hours,
            datasets: [
                {
                    label: `${t('sell')} ${t('price')} (R$/kWh)`,
                    data: sellPrice,
                    backgroundColor: hours.map((_, i) => {
                        if (i >= 17 && i < 20) return 'rgba(220, 38, 38, 0.8)';
                        if ((i >= 6 && i < 17) || (i >= 20 && i < 22)) return 'rgba(217, 119, 6, 0.6)';
                        return 'rgba(5, 150, 105, 0.6)';
                    }),
                    borderRadius: 4,
                    order: 2
                },
                {
                    label: `${t('buy')} ${t('cost')} (R$/kWh)`,
                    data: buyPrice,
                    type: 'line',
                    borderColor: '#64748b',
                    borderDash: [5, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    order: 1
                },
                {
                    label: `${t('margin')} (R$/kWh)`,
                    data: margin,
                    type: 'line',
                    borderColor: '#059669',
                    backgroundColor: 'rgba(5, 150, 105, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    order: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { usePointStyle: true, padding: 20 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': R$ ' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'R$ ' + value.toFixed(2);
                        }
                    },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

// ============================================
// Chart: Revenue Trend (7 days)
// ============================================
function initializeRevenueTrendChart() {
    const ctx = document.getElementById('revenueTrendChart');
    if (!ctx) return;

    const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const translatedLabels = weekdays.map(day => t(day));

    revenueTrendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: translatedLabels,
            datasets: [
                {
                    label: t('gross_revenue'),
                    data: mockData.revenueTrend.receita,
                    backgroundColor: 'rgba(55, 48, 163, 0.7)',
                    borderRadius: 6,
                    order: 2
                },
                {
                    label: t('cost'),
                    data: mockData.revenueTrend.custo,
                    backgroundColor: 'rgba(220, 38, 38, 0.5)',
                    borderRadius: 6,
                    order: 2
                },
                {
                    label: t('net_profit'),
                    data: mockData.revenueTrend.lucro,
                    type: 'line',
                    borderColor: '#059669',
                    backgroundColor: 'rgba(5, 150, 105, 0.1)',
                    tension: 0.4,
                    fill: true,
                    borderWidth: 3,
                    pointBackgroundColor: '#059669',
                    pointRadius: 5,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { usePointStyle: true, padding: 15 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': R$ ' + context.parsed.y.toLocaleString('pt-BR');
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'R$ ' + (value / 1000).toFixed(0) + 'k';
                        }
                    },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

// ============================================
// Chart: Revenue Breakdown (Doughnut)
// ============================================
function initializeRevenueBreakdownChart() {
    const ctx = document.getElementById('revenueBreakdownChart');
    if (!ctx) return;

    revenueBreakdownChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: [t('tariff_arbitrage'), t('demand_response'), t('ancillary_services')],
            datasets: [{
                data: mockData.revenueBreakdown.values,
                backgroundColor: mockData.revenueBreakdown.colors,
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 15, usePointStyle: true }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((context.parsed / total) * 100).toFixed(1);
                            return context.label + ': R$ ' + context.parsed.toLocaleString('pt-BR') + ' (' + pct + '%)';
                        }
                    }
                }
            }
        }
    });
}

// ============================================
// Populate Asset Cards
// ============================================
function populateAssets() {
    const grid = document.getElementById('assetsGrid');
    if (!grid) return;

    mockData.assets.forEach(asset => {
        const card = document.createElement('div');
        card.className = 'site-card';
        card.setAttribute('data-asset-id', asset.id);

        const statusClass = asset.status === 'operando' ? 'status-online' : 'status-charging';
        const statusText = asset.status === 'operando' ? t('sell_operation') : t('charging');
        const statusIcon = asset.status === 'operando' ? 'trending_up' : 'battery_charging_full';

        const modeConfig = OPERATION_MODES[asset.operationMode];
        const isSelected = batchState.selectedAssets.has(asset.id);

        if (isSelected) {
            card.classList.add('selected');
        }

        card.innerHTML = `
            <div class="site-header">
                <div class="site-name">
                    <label class="asset-checkbox-wrapper" onclick="event.stopPropagation()">
                        <input type="checkbox"
                               class="asset-checkbox"
                               data-asset-id="${asset.id}"
                               ${isSelected ? 'checked' : ''}
                               onchange="toggleAssetSelection('${asset.id}')">
                        <span class="asset-checkmark"></span>
                    </label>
                    <span class="material-icons asset-region-icon">location_on</span>
                    ${asset.name}
                </div>
                <div class="site-status ${statusClass}">
                    <span class="material-icons tiny-icon">${statusIcon}</span> ${statusText}
                </div>
            </div>
            <div class="asset-mode-badge"
                 style="background:${modeConfig.bgColor};color:${modeConfig.color};border:1px solid ${modeConfig.borderColor}">
                <span class="material-icons tiny-icon">${modeConfig.icon}</span>
                ${t('current_mode')}: ${t('mode_' + asset.operationMode)}
            </div>
            <div class="site-metrics">
                <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">payments</span> ${t('today_profit')}</span>
                    <span class="metric-value profit-text">R$ ${asset.lucroHoje.toLocaleString('pt-BR')}</span>
                </div>
                <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">trending_up</span> ${t('monthly_roi')}</span>
                    <span class="metric-value">${asset.roi}%</span>
                </div>
                <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">savings</span> ${t('investment')}</span>
                    <span class="metric-value">R$ ${(asset.investimento / 1000000).toFixed(1)}M</span>
                </div>
                <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">battery_std</span> ${t('soc')} ${t('average')}</span>
                    <span class="metric-value">${asset.socMedio}%</span>
                </div>
                <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">devices</span> ${t('units')}</span>
                    <span class="metric-value">${asset.unidades.toLocaleString('pt-BR')}</span>
                </div>
                <div class="metric">
                    <span class="metric-label"><span class="material-icons tiny-icon">update</span> ${t('payback')}</span>
                    <span class="metric-value">${asset.payback} ${t('years')}</span>
                </div>
            </div>
            <div class="asset-footer">
                <div class="asset-progress">
                    <span class="asset-progress-label">${t('daily_progress')} ${t('vs_target')}</span>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${Math.min(100, (asset.receitaHoje / 20000) * 100)}%"></div>
                    </div>
                    <span class="asset-progress-text">R$ ${asset.receitaHoje.toLocaleString('pt-BR')} / R$ 20.000</span>
                </div>
            </div>
        `;

        // Card click toggles selection (except when clicking checkbox directly)
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.asset-checkbox-wrapper')) {
                toggleAssetSelection(asset.id);
            }
        });

        grid.appendChild(card);
    });
}

// ============================================
// Populate Trade Table
// ============================================
function populateTrades() {
    const table = document.getElementById('tradeTable');
    if (!table) return;

    mockData.trades.forEach(trade => {
        const row = document.createElement('tr');
        const opText = t(trade.operacao);
        const opClass = trade.operacao.includes('buy') ? 'op-buy' :
                        trade.operacao.includes('sell') ? 'op-sell' : 'op-hold';
        const statusClass = trade.status === 'executed' ? 'status-done' :
                           trade.status === 'executing' ? 'status-active' : 'status-pending';
        const tariffText = t(trade.tarifa);
        const tariffCssClass = trade.tarifa === 'peak' ? 'tariff-ponta' :
                               trade.tarifa === 'off_peak' ? 'tariff-fora-ponta' : 'tariff-intermediaria';

        row.innerHTML = `
            <td>${trade.time}</td>
            <td><span class="tariff-badge ${tariffCssClass}">${tariffText}</span></td>
            <td><span class="op-badge ${opClass}">${opText}</span></td>
            <td>${trade.preco}</td>
            <td>${trade.volume}</td>
            <td class="${trade.resultado.startsWith('+') ? 'profit-text' : trade.resultado.startsWith('-') ? 'cost-text' : ''}">${trade.resultado}</td>
            <td><span class="trade-status ${statusClass}">${t(trade.status)}</span></td>
        `;
        table.appendChild(row);
    });
}

// ============================================
// Real-Time Updates
// ============================================
function startRealTimeUpdates() {
    setInterval(() => {
        updateFinancialMetrics();
        updateRevenueCurveChart();
    }, 5000);
}

function updateFinancialMetrics() {
    const baseProfit = 48235;
    const variation = Math.floor(Math.random() * 1000 - 300);
    const todayProfit = baseProfit + variation;
    const revenue = todayProfit + 14215;
    const roi = (18.7 + (Math.random() * 0.4 - 0.2)).toFixed(1);

    const profitEl = document.getElementById('todayProfit');
    if (profitEl) profitEl.textContent = 'R$ ' + todayProfit.toLocaleString('pt-BR');

    const roiEl = document.getElementById('monthlyROI');
    if (roiEl) roiEl.textContent = '+' + roi + '%';

    const kpiRevEl = document.getElementById('kpiRevenue');
    if (kpiRevEl) kpiRevEl.textContent = 'R$ ' + revenue.toLocaleString('pt-BR');

    const kpiNetEl = document.getElementById('kpiNet');
    if (kpiNetEl) kpiNetEl.textContent = 'R$ ' + todayProfit.toLocaleString('pt-BR');

    // Update market conditions with translated text
    const hour = new Date().getHours();
    let tariff, price, margin, nextWindow, signal;

    if (hour >= 17 && hour < 20) {
        tariff = t('peak');
        price = 'R$ 0,82/kWh';
        margin = 'R$ 0,57/kWh';
        nextWindow = `20:00 (${t('intermediate')})`;
        signal = t('sell_now');
    } else if (hour >= 0 && hour < 6) {
        tariff = t('off_peak');
        price = 'R$ 0,25/kWh';
        margin = 'R$ 0,00/kWh';
        nextWindow = `06:00 (${t('intermediate')})`;
        signal = t('signal_buy_charge');
    } else if ((hour >= 6 && hour < 17) || (hour >= 20 && hour < 22)) {
        tariff = t('intermediate');
        price = 'R$ 0,45/kWh';
        margin = 'R$ 0,20/kWh';
        nextWindow = hour < 17 ? `17:00 (${t('peak_max_margin')})` : `22:00 (${t('off_peak')})`;
        signal = hour < 17 ? t('signal_wait_peak') : t('signal_prepare_buy');
    } else {
        tariff = t('off_peak');
        price = 'R$ 0,25/kWh';
        margin = 'R$ 0,00/kWh';
        nextWindow = `00:00 (${t('off_peak')})`;
        signal = t('signal_buy_charge');
    }

    const tariffEl = document.getElementById('currentTariff');
    if (tariffEl) tariffEl.textContent = tariff;

    const badgeEl = document.getElementById('tariffBadge');
    if (badgeEl) {
        badgeEl.textContent = price;
        // Use original tariff key for CSS class determination
        const isPeak = hour >= 17 && hour < 20;
        const isOffPeak = (hour >= 0 && hour < 6) || hour >= 22;
        badgeEl.className = isPeak ? 'badge badge-peak' :
                           isOffPeak ? 'badge badge-offpeak' : 'badge badge-mid';
    }

    const marginEl = document.getElementById('currentMargin');
    if (marginEl) marginEl.textContent = margin;

    const windowEl = document.getElementById('nextWindow');
    if (windowEl) windowEl.textContent = nextWindow;

    const signalEl = document.getElementById('marketSignal');
    if (signalEl) {
        const isSell = hour >= 17 && hour < 20;
        const isBuy = (hour >= 0 && hour < 6) || hour >= 22;
        signalEl.className = 'market-signal' + (isSell ? ' signal-sell' : isBuy ? ' signal-buy' : ' signal-wait');
        const icon = isSell ? 'bolt' : isBuy ? 'download' : 'schedule';
        signalEl.innerHTML = `<span class="material-icons">${icon}</span><span id="marketSignalText">${signal}</span>`;
    }

    const spreadEl = document.getElementById('kpiSpread');
    if (spreadEl) spreadEl.textContent = margin;

    const activeEl = document.getElementById('activeAssets');
    if (activeEl) {
        const active = 2847 + Math.floor(Math.random() * 10 - 5);
        activeEl.textContent = active.toLocaleString('pt-BR');
    }
}

function updateRevenueCurveChart() {
    if (!revenueCurveChart) return;
    const datasets = revenueCurveChart.data.datasets;
    const hour = new Date().getHours();
    if (hour < 24 && datasets[0].data[hour] !== undefined) {
        datasets[0].data[hour] += Math.random() * 200 - 50;
        if (datasets[0].data[hour] < 0) datasets[0].data[hour] = 0;
    }
    revenueCurveChart.update('none');
}

// ============================================
// Modal: Trade Opportunity
// ============================================
function simulateTradeOpportunity() {
    document.getElementById('tradeModal').classList.add('show');
}

function acceptTrade() {
    const msg = `${t('trade_executed_msg')}\n\n` +
        `${t('selling_detail')}\n` +
        `${t('profit_estimate_10k')}\n\n` +
        `${t('operation_registered')}`;
    alert(msg);
    document.getElementById('tradeModal').classList.remove('show');
}

function viewDetails() {
    const sep = '━━━━━━━━━━━━━━━━━━━━━━━━';
    const msg = `${t('opportunity_details_title')}\n${sep}\n` +
        `${t('detail_capacity')}\n` +
        `${t('detail_assets_online')}\n` +
        `${t('detail_avg_soc')}\n` +
        `${t('detail_spot_price')}\n` +
        `${t('detail_avg_charge')}\n` +
        `${t('detail_gross_margin')}\n` +
        `${t('detail_est_revenue')}\n` +
        `${t('detail_est_net_profit')}`;
    alert(msg);
}

function rejectTrade() {
    document.getElementById('tradeModal').classList.remove('show');
}

// Close modal on backdrop click
document.getElementById('tradeModal').addEventListener('click', function(e) {
    if (e.target === this) {
        this.classList.remove('show');
    }
});

// Close batch confirm modal on backdrop click
document.getElementById('batchConfirmModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeBatchConfirmModal();
    }
});

// Prevent closing progress modal during dispatch (only allow when close button is enabled)
document.getElementById('batchProgressModal').addEventListener('click', function(e) {
    if (e.target === this && !batchState.isDispatching) {
        closeProgressModal();
    }
});

// ============================================
// Batch Operations: Toolbar Initialization
// ============================================
function initBatchToolbar() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const batchResetBtn = document.getElementById('batchResetBtn');
    const batchDispatchBtn = document.getElementById('batchDispatchBtn');
    const modeBtnGroup = document.getElementById('modeBtnGroup');

    if (!selectAllCheckbox) return;

    // Select All checkbox
    selectAllCheckbox.addEventListener('change', () => {
        toggleSelectAll();
    });

    // Select All label click
    const batchLabel = document.querySelector('.batch-label');
    if (batchLabel) {
        batchLabel.addEventListener('click', () => {
            selectAllCheckbox.checked = !selectAllCheckbox.checked;
            toggleSelectAll();
        });
    }

    // Reset button
    batchResetBtn.addEventListener('click', () => {
        resetBatchSelection();
    });

    // Mode buttons
    modeBtnGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.mode-btn');
        if (btn) {
            selectMode(btn.getAttribute('data-mode'));
        }
    });

    // Dispatch button
    batchDispatchBtn.addEventListener('click', () => {
        startBatchDispatch();
    });

    // Update total count
    document.getElementById('totalCount').textContent = mockData.assets.length;
}

// ============================================
// Batch Operations: Selection Logic
// ============================================
function toggleAssetSelection(assetId) {
    if (batchState.isDispatching) return;

    if (batchState.selectedAssets.has(assetId)) {
        batchState.selectedAssets.delete(assetId);
    } else {
        batchState.selectedAssets.add(assetId);
    }
    updateBatchUI();
}

function toggleSelectAll() {
    if (batchState.isDispatching) return;

    const allIds = mockData.assets.map(a => a.id);
    if (batchState.selectedAssets.size === allIds.length) {
        batchState.selectedAssets.clear();
    } else {
        allIds.forEach(id => batchState.selectedAssets.add(id));
    }
    updateBatchUI();
}

function updateBatchUI() {
    const count = batchState.selectedAssets.size;
    const total = mockData.assets.length;

    // Update count display
    document.getElementById('selectedCount').textContent = count;

    // Update select-all checkbox state
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const checkmark = selectAllCheckbox.nextElementSibling;
    if (count === 0) {
        selectAllCheckbox.checked = false;
        checkmark.classList.remove('indeterminate');
    } else if (count === total) {
        selectAllCheckbox.checked = true;
        checkmark.classList.remove('indeterminate');
    } else {
        selectAllCheckbox.checked = false;
        checkmark.classList.add('indeterminate');
    }

    // Update reset button
    document.getElementById('batchResetBtn').disabled = count === 0 && !batchState.targetMode;

    // Update dispatch button
    document.getElementById('batchDispatchBtn').disabled = count === 0 || !batchState.targetMode;

    // Update toolbar border
    const toolbar = document.getElementById('batchToolbar');
    toolbar.classList.toggle('has-selection', count > 0);

    // Update card checkboxes and selection highlight
    mockData.assets.forEach(asset => {
        const card = document.querySelector(`.site-card[data-asset-id="${asset.id}"]`);
        if (!card) return;
        const checkbox = card.querySelector('.asset-checkbox');
        const isSelected = batchState.selectedAssets.has(asset.id);
        if (checkbox) checkbox.checked = isSelected;
        card.classList.toggle('selected', isSelected);
    });
}

function selectMode(mode) {
    if (batchState.isDispatching) return;

    batchState.targetMode = mode;

    // Update mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });

    updateBatchUI();
}

function resetBatchSelection() {
    batchState.selectedAssets.clear();
    batchState.targetMode = null;

    // Reset mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));

    updateBatchUI();
}

// ============================================
// Batch Operations: Dispatch Flow
// ============================================
function getAssetsToChange() {
    return mockData.assets.filter(asset =>
        batchState.selectedAssets.has(asset.id) &&
        asset.operationMode !== batchState.targetMode
    );
}

function startBatchDispatch() {
    if (batchState.selectedAssets.size === 0 || !batchState.targetMode) return;

    const assetsToChange = getAssetsToChange();
    if (assetsToChange.length === 0) {
        alert(t('all_in_target_mode'));
        return;
    }

    showConfirmModal(assetsToChange);
}

function showConfirmModal(assetsToChange) {
    const list = document.getElementById('batchChangeList');
    const impact = document.getElementById('batchImpactBox');

    let totalUnits = 0;
    list.innerHTML = assetsToChange.map(asset => {
        totalUnits += asset.unidades;
        const fromMode = t('mode_' + asset.operationMode);
        const toMode = t('mode_' + batchState.targetMode);
        return `
            <div class="batch-change-item">
                <span class="material-icons">location_on</span>
                <strong>${asset.name}</strong>
                <span>${fromMode}</span>
                <span class="material-icons batch-change-arrow">arrow_forward</span>
                <span>${toMode}</span>
            </div>
        `;
    }).join('');

    impact.innerHTML = `
        <span class="material-icons">warning</span>
        <span>${t('batch_impact_warning')}</span>
        <span style="margin-left:auto; font-weight:700;">
            ${assetsToChange.length} ${t('affected_sites')} / ${totalUnits.toLocaleString('pt-BR')} ${t('affected_units')}
        </span>
    `;

    document.getElementById('batchConfirmModal').classList.add('show');
}

function closeBatchConfirmModal() {
    document.getElementById('batchConfirmModal').classList.remove('show');
}

async function executeBatchDispatch() {
    // Close confirm modal
    document.getElementById('batchConfirmModal').classList.remove('show');

    // Show progress modal
    const progressModal = document.getElementById('batchProgressModal');
    progressModal.classList.add('show');

    batchState.isDispatching = true;
    batchState.dispatchResults = [];
    const assetsToChange = getAssetsToChange();

    // Reset progress UI
    document.getElementById('progressIcon').textContent = 'sync';
    document.getElementById('progressIcon').className = 'material-icons modal-icon spinning';
    document.getElementById('progressTitle').textContent = t('batch_dispatching');
    document.getElementById('closeProgressBtn').disabled = true;
    document.getElementById('retryBtn').style.display = 'none';
    document.getElementById('overallProgressText').textContent = `0 / ${assetsToChange.length}`;
    document.getElementById('overallProgressFill').style.width = '0%';

    // Render progress list
    const progressList = document.getElementById('dispatchProgressList');
    progressList.innerHTML = assetsToChange.map((asset, i) => {
        const toMode = t('mode_' + batchState.targetMode);
        return `
            <div class="dispatch-progress-item" data-progress-asset="${asset.id}">
                <span class="material-icons progress-status-icon status-waiting">hourglass_empty</span>
                <div class="dispatch-item-info">
                    <div class="dispatch-item-name">${asset.name}</div>
                    <div class="dispatch-item-detail">${toMode} (${asset.unidades} ${t('affected_units')})</div>
                </div>
                <div class="dispatch-item-progress">
                    <div class="progress-bar">
                        <div class="progress-fill dispatch-progress-fill" style="width:0%"></div>
                    </div>
                </div>
                <span class="progress-status-text">${t('dispatch_waiting')}</span>
            </div>
        `;
    }).join('');

    // Execute sequentially
    for (let i = 0; i < assetsToChange.length; i++) {
        const asset = assetsToChange[i];
        updateDispatchProgress(asset.id, 'executing', 0);

        const result = await simulateAssetModeChange(asset, batchState.targetMode);
        batchState.dispatchResults.push(result);

        updateDispatchProgress(asset.id, result.success ? 'success' : 'failed', 100);

        if (result.success) {
            asset.operationMode = batchState.targetMode;
        }

        // Update overall progress
        updateOverallProgress(assetsToChange.length);
    }

    batchState.isDispatching = false;

    // Show result
    showDispatchResult(batchState.dispatchResults);

    // Refresh asset cards
    const grid = document.getElementById('assetsGrid');
    grid.innerHTML = '';
    populateAssets();
    updateBatchUI();
}

function simulateAssetModeChange(asset, newMode) {
    return new Promise((resolve) => {
        const duration = 2000 + Math.random() * 2000;
        const steps = 10;
        let currentStep = 0;

        const interval = setInterval(() => {
            currentStep++;
            const progress = Math.round((currentStep / steps) * 100);
            updateDispatchProgress(asset.id, 'executing', progress);

            if (currentStep >= steps) {
                clearInterval(interval);
                const success = Math.random() > 0.1; // 90% success rate
                resolve({
                    assetId: asset.id,
                    assetName: asset.name,
                    fromMode: asset.operationMode,
                    toMode: newMode,
                    success: success,
                    error: success ? null : 'communication_timeout',
                    units: asset.unidades,
                    timestamp: new Date().toISOString()
                });
            }
        }, duration / steps);
    });
}

function updateDispatchProgress(assetId, status, progress) {
    const item = document.querySelector(`[data-progress-asset="${assetId}"]`);
    if (!item) return;

    const statusIcon = item.querySelector('.progress-status-icon');
    const progressBar = item.querySelector('.dispatch-progress-fill');
    const statusText = item.querySelector('.progress-status-text');

    if (status === 'executing') {
        statusIcon.textContent = 'sync';
        statusIcon.className = 'material-icons progress-status-icon spinning';
        statusText.textContent = `${progress}%`;
        item.className = 'dispatch-progress-item';
    } else if (status === 'success') {
        statusIcon.textContent = 'check_circle';
        statusIcon.className = 'material-icons progress-status-icon status-success';
        statusText.textContent = t('dispatch_success');
        item.className = 'dispatch-progress-item success';
    } else if (status === 'failed') {
        statusIcon.textContent = 'error';
        statusIcon.className = 'material-icons progress-status-icon status-failed';
        statusText.textContent = t('dispatch_failed');
        item.className = 'dispatch-progress-item failed';
    } else if (status === 'waiting') {
        statusIcon.textContent = 'hourglass_empty';
        statusIcon.className = 'material-icons progress-status-icon status-waiting';
        statusText.textContent = t('dispatch_waiting');
    }

    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
}

function updateOverallProgress(total) {
    const completed = batchState.dispatchResults.length;
    const overallBar = document.getElementById('overallProgressFill');
    const overallText = document.getElementById('overallProgressText');

    if (overallBar) overallBar.style.width = `${(completed / total) * 100}%`;
    if (overallText) overallText.textContent = `${completed} / ${total}`;
}

function showDispatchResult(results) {
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    // Update title
    document.getElementById('progressIcon').textContent = failedCount > 0 ? 'warning' : 'check_circle';
    document.getElementById('progressIcon').className = 'material-icons modal-icon';
    document.getElementById('progressIcon').style.color = failedCount > 0 ? '#d97706' : '#059669';
    document.getElementById('progressTitle').textContent = t('batch_complete');

    // Add result summary before progress list
    const progressList = document.getElementById('dispatchProgressList');
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'dispatch-result-summary';
    summaryDiv.innerHTML = `
        <span class="result-success-count">${t('success_count')}: ${successCount}/${results.length}</span>
        <span class="result-failed-count">${t('failed_count')}: ${failedCount}/${results.length}</span>
    `;
    progressList.insertBefore(summaryDiv, progressList.firstChild);

    // Update failed items with error reason
    results.filter(r => !r.success).forEach(r => {
        const item = document.querySelector(`[data-progress-asset="${r.assetId}"]`);
        if (item) {
            const detail = item.querySelector('.dispatch-item-detail');
            if (detail) {
                detail.textContent = t(r.error);
            }
        }
    });

    // Enable close button
    document.getElementById('closeProgressBtn').disabled = false;

    // Show retry button if there are failures
    if (failedCount > 0) {
        document.getElementById('retryBtn').style.display = 'flex';
    }
}

function closeProgressModal() {
    document.getElementById('batchProgressModal').classList.remove('show');
    resetBatchSelection();
}

async function retryFailedItems() {
    const failedResults = batchState.dispatchResults.filter(r => !r.success);
    const failedAssets = failedResults.map(r =>
        mockData.assets.find(a => a.id === r.assetId)
    ).filter(Boolean);

    if (failedAssets.length === 0) return;

    // Keep only successful results
    batchState.dispatchResults = batchState.dispatchResults.filter(r => r.success);
    batchState.isDispatching = true;

    // Reset UI for retry
    document.getElementById('progressIcon').textContent = 'sync';
    document.getElementById('progressIcon').className = 'material-icons modal-icon spinning';
    document.getElementById('progressIcon').style.color = '#3730a3';
    document.getElementById('progressTitle').textContent = t('batch_dispatching');
    document.getElementById('closeProgressBtn').disabled = true;
    document.getElementById('retryBtn').style.display = 'none';

    // Remove summary
    const summary = document.querySelector('.dispatch-result-summary');
    if (summary) summary.remove();

    // Reset failed items UI
    failedAssets.forEach(asset => {
        updateDispatchProgress(asset.id, 'waiting', 0);
    });

    const total = batchState.dispatchResults.length + failedAssets.length;
    updateOverallProgress(total);

    for (let i = 0; i < failedAssets.length; i++) {
        const asset = failedAssets[i];
        updateDispatchProgress(asset.id, 'executing', 0);

        const result = await simulateAssetModeChange(asset, batchState.targetMode);
        batchState.dispatchResults.push(result);

        updateDispatchProgress(asset.id, result.success ? 'success' : 'failed', 100);

        if (result.success) {
            asset.operationMode = batchState.targetMode;
        }

        updateOverallProgress(total);
    }

    batchState.isDispatching = false;
    showDispatchResult(batchState.dispatchResults);

    // Refresh asset cards
    const grid = document.getElementById('assetsGrid');
    grid.innerHTML = '';
    populateAssets();
    updateBatchUI();
}

// ============================================
// Period Selector (Reports)
// ============================================
function setPeriod(btn, days) {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}
